use std::{
    io::{self, Stdout},
    process::{Command, ExitCode},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use crossterm::{
    cursor::{Hide, Show},
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Frame, Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::{Line, Span},
    widgets::{Cell, Paragraph, Row, Table, TableState},
};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
struct ContextDetails {
    #[serde(default)]
    namespace: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct KubeContext {
    #[serde(default)]
    name: String,
    #[serde(default)]
    context: Option<ContextDetails>,
}

#[derive(Debug, Default, Deserialize)]
struct Config {
    #[serde(default)]
    contexts: Option<Vec<KubeContext>>,
    #[serde(default, rename = "current-context")]
    current: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct Context {
    name: String,
    namespace: String,
}

fn parse_config(data: &[u8]) -> Result<(Vec<Context>, String), String> {
    let config: Config = serde_json::from_slice(if data.is_empty() { b"{}" } else { data })
        .map_err(|error| format!("Invalid kubectl JSON: {error}"))?;
    let mut contexts: Vec<_> = config
        .contexts
        .unwrap_or_default()
        .into_iter()
        .map(|item| Context {
            name: item.name,
            namespace: item
                .context
                .unwrap_or_default()
                .namespace
                .unwrap_or_default(),
        })
        .collect();
    contexts.sort_by(|a, b| (&a.name, &a.namespace).cmp(&(&b.name, &b.namespace)));
    Ok((contexts, config.current.unwrap_or_default()))
}

fn command_output(args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("kubectl")
        .args(args)
        .output()
        .map_err(|error| format!("kubectl: {error}"))?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if message.is_empty() {
            format!("kubectl {} failed", args.join(" "))
        } else {
            message
        })
    }
}

fn rank(name: &str, query: &str) -> Option<u8> {
    let name = name.to_lowercase();
    let query = query.to_lowercase();
    if query.is_empty() || name == query {
        return Some(0);
    }
    if name.contains(&query) {
        return Some(1);
    }
    let mut letters = name.chars();
    query
        .chars()
        .all(|wanted| letters.any(|letter| letter == wanted))
        .then_some(2)
}

struct App {
    contexts: Vec<Context>,
    current: String,
    query: String,
    index: usize,
    message: String,
}

enum Action {
    Continue,
    Quit,
    Switch(String),
}

impl App {
    fn load() -> Self {
        let (contexts, current, message) = match command_output(&["config", "view", "-o", "json"])
            .and_then(|data| parse_config(&data))
        {
            Ok((contexts, current)) => (contexts, current, String::new()),
            Err(message) => (Vec::new(), String::new(), message),
        };
        Self {
            contexts,
            current,
            query: String::new(),
            index: 0,
            message,
        }
    }

    fn shown(&self) -> Vec<&Context> {
        let mut matches: Vec<_> = self
            .contexts
            .iter()
            .filter_map(|context| rank(&context.name, &self.query).map(|score| (score, context)))
            .collect();
        matches.sort_by_key(|(score, _)| *score);
        matches.into_iter().map(|(_, context)| context).collect()
    }

    fn key(&mut self, key: KeyEvent) -> Action {
        if key.kind == KeyEventKind::Release {
            return Action::Continue;
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return Action::Quit;
        }
        match key.code {
            KeyCode::Esc if self.query.is_empty() => return Action::Quit,
            KeyCode::Esc => {
                self.query.clear();
                self.index = 0;
            }
            KeyCode::Down => {
                self.index = (self.index + 1).min(self.shown().len().saturating_sub(1))
            }
            KeyCode::Up => self.index = self.index.saturating_sub(1),
            KeyCode::Backspace => {
                self.query.pop();
                self.index = 0;
            }
            KeyCode::Enter => {
                if let Some(context) = self.shown().get(self.index) {
                    return Action::Switch(context.name.clone());
                }
            }
            KeyCode::Char(letter)
                if !letter.is_control()
                    && !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                self.query.push(letter);
                self.index = 0;
            }
            _ => {}
        }
        Action::Continue
    }

    fn draw(&self, frame: &mut Frame) {
        let area = frame.area();
        if area.width == 0 || area.height == 0 {
            return;
        }
        let area = Rect::new(
            area.x.saturating_add(1),
            area.y,
            area.width.saturating_sub(2),
            area.height,
        );
        let parts = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(area);
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    "Kubernetes contexts",
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(
                        "  current: {}",
                        if self.current.is_empty() {
                            "none"
                        } else {
                            &self.current
                        }
                    ),
                    Style::default().add_modifier(Modifier::DIM),
                ),
            ])),
            parts[0],
        );
        frame.render_widget(Paragraph::new(format!("› {}", self.query)).bold(), parts[1]);
        let shown = self.shown();
        if shown.is_empty() {
            frame.render_widget(
                Paragraph::new(if self.contexts.is_empty() {
                    "No contexts in kubeconfig."
                } else {
                    "No matching contexts."
                }),
                parts[3],
            );
        } else {
            let name_width = shown
                .iter()
                .map(|context| context.name.chars().count())
                .max()
                .unwrap_or(10)
                .max(10);
            let rows = shown.iter().map(|context| {
                let current = context.name == self.current;
                let row = Row::new(vec![
                    Cell::from(if current { "*" } else { " " }),
                    Cell::from(context.name.as_str()),
                    Cell::from(context.namespace.as_str()),
                ]);
                if current {
                    row.style(Style::default().fg(Color::Green))
                } else {
                    row
                }
            });
            let table = Table::new(
                rows,
                [
                    Constraint::Length(1),
                    Constraint::Length(
                        name_width.min(usize::from(parts[3].width.saturating_sub(4))) as u16,
                    ),
                    Constraint::Min(0),
                ],
            )
            .column_spacing(1)
            .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED));
            let visible = usize::from(parts[3].height).max(1);
            let top = self
                .index
                .saturating_sub(visible / 2)
                .min(shown.len().saturating_sub(visible));
            let mut state = TableState::default()
                .with_offset(top)
                .with_selected(Some(self.index));
            frame.render_stateful_widget(table, parts[3], &mut state);
        }
        frame.render_widget(
            Paragraph::new("type to filter   enter switch   esc clear/quit").dim(),
            parts[4],
        );
        frame.render_widget(Paragraph::new(self.message.as_str()).bold(), parts[5]);
    }
}

struct Screen(Terminal<CrosstermBackend<Stdout>>);

fn restore_screen() {
    let _ = execute!(io::stdout(), LeaveAlternateScreen, Show);
    let _ = disable_raw_mode();
}

impl Screen {
    fn new() -> io::Result<Self> {
        enable_raw_mode()?;
        if let Err(error) = execute!(io::stdout(), EnterAlternateScreen, Hide) {
            restore_screen();
            return Err(error);
        }
        match Terminal::new(CrosstermBackend::new(io::stdout())) {
            Ok(terminal) => Ok(Self(terminal)),
            Err(error) => {
                restore_screen();
                Err(error)
            }
        }
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        restore_screen();
    }
}

fn run() -> io::Result<()> {
    let stopped = Arc::new(AtomicBool::new(false));
    for signal in [
        signal_hook::consts::SIGINT,
        signal_hook::consts::SIGTERM,
        signal_hook::consts::SIGHUP,
    ] {
        signal_hook::flag::register(signal, Arc::clone(&stopped))?;
    }
    let mut app = App::load();
    let mut screen = Screen::new()?;
    while !stopped.load(Ordering::Relaxed) {
        screen.0.draw(|frame| app.draw(frame))?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        if let Event::Key(key) = event::read()? {
            match app.key(key) {
                Action::Quit => break,
                Action::Switch(name) => {
                    match command_output(&["config", "use-context", "--", &name]) {
                        Ok(_) => break,
                        Err(message) => app.message = message,
                    }
                }
                Action::Continue => {}
            }
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("-h" | "--help") => {
            println!(
                "kctx - switch Kubernetes context\n\nType to filter; Up/Down to move; Enter to switch; Esc to clear/quit."
            );
            return ExitCode::SUCCESS;
        }
        Some("-V" | "--version") => {
            println!("kctx {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some(arg) => {
            eprintln!("kctx: unexpected argument: {arg}");
            return ExitCode::FAILURE;
        }
        None => {}
    }
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("kctx: {error}");
            ExitCode::FAILURE
        }
    }
}
