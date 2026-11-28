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
    widgets::{Cell, Paragraph, Row, Table, TableState, Wrap},
};
use serde::Deserialize;
use std::{
    io::{self, Stdout},
    process::{Command, ExitCode, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

#[derive(Clone, Deserialize)]
struct Subscription {
    id: String,
    name: String,
    #[serde(rename = "tenantId")]
    tenant: String,
    #[serde(default, rename = "isDefault")]
    current: bool,
    state: String,
}

fn azure(args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("az")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("az: {error}. Install Azure CLI with bootstrap."))?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(if message.is_empty() {
        format!("az {} failed", args.join(" "))
    } else {
        message
    })
}

fn uuid(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(part, length)| {
            part.len() == length && part.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn subscriptions(refresh: bool) -> Result<Vec<Subscription>, String> {
    // No --all: it includes disabled subscriptions and other Azure clouds.
    // The default list contains enabled subscriptions in the current cloud.
    let mut args = vec!["account", "list", "--output", "json", "--only-show-errors"];
    if refresh {
        args.push("--refresh");
    }
    let data = azure(&args)?;
    let mut subscriptions: Vec<Subscription> = serde_json::from_slice(&data)
        .map_err(|error| format!("Invalid Azure CLI JSON: {error}"))?;
    subscriptions.retain(|subscription| subscription.state.eq_ignore_ascii_case("enabled"));
    if subscriptions
        .iter()
        .any(|subscription| !uuid(&subscription.id) || !uuid(&subscription.tenant))
    {
        return Err("Azure CLI returned an invalid subscription or tenant ID".into());
    }
    subscriptions.sort_by(|a, b| (&a.tenant, &a.name, &a.id).cmp(&(&b.tenant, &b.name, &b.id)));
    Ok(subscriptions)
}

fn rank(text: &str, query: &str) -> Option<u8> {
    let text = text.to_lowercase();
    let query = query.to_lowercase();
    if query.is_empty() || text == query {
        return Some(0);
    }
    if text.contains(&query) {
        return Some(1);
    }
    let mut letters = text.chars();
    query
        .chars()
        .all(|wanted| letters.any(|letter| letter == wanted))
        .then_some(2)
}

struct App {
    subscriptions: Vec<Subscription>,
    query: String,
    index: usize,
    message: String,
    pending: Option<Subscription>,
}

enum Action {
    Continue,
    Quit,
    Refresh,
    Switch(Subscription),
}

impl App {
    fn new() -> Self {
        let mut app = Self {
            subscriptions: Vec::new(),
            query: String::new(),
            index: 0,
            message: String::new(),
            pending: None,
        };
        app.load(false);
        app
    }

    fn load(&mut self, refresh: bool) {
        match subscriptions(refresh) {
            Ok(subscriptions) => {
                self.subscriptions = subscriptions;
                self.query.clear();
                self.index = self
                    .subscriptions
                    .iter()
                    .position(|subscription| subscription.current)
                    .unwrap_or(0);
                self.message = if self.subscriptions.is_empty() {
                    "No enabled subscriptions in the current cloud. Run az login, then Ctrl+R to refresh.".into()
                } else {
                    String::new()
                };
            }
            Err(error) => self.message = error,
        }
    }

    fn shown(&self) -> Vec<&Subscription> {
        let mut matches: Vec<_> = self
            .subscriptions
            .iter()
            .filter_map(|subscription| {
                let score = [&subscription.name, &subscription.id, &subscription.tenant]
                    .into_iter()
                    .filter_map(|value| rank(value, &self.query))
                    .min()?;
                Some((score, subscription))
            })
            .collect();
        matches.sort_by_key(|(score, _)| *score);
        matches
            .into_iter()
            .map(|(_, subscription)| subscription)
            .collect()
    }

    fn key(&mut self, key: KeyEvent) -> Action {
        if key.kind == KeyEventKind::Release {
            return Action::Continue;
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return Action::Quit;
        }
        if let Some(subscription) = self.pending.clone() {
            match key.code {
                KeyCode::Esc => {
                    self.pending = None;
                    self.message.clear();
                }
                KeyCode::Char('y' | 'Y')
                    if key.kind == KeyEventKind::Press
                        && !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    return Action::Switch(subscription);
                }
                _ => {}
            }
            return Action::Continue;
        }
        if key.code == KeyCode::Char('r') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return Action::Refresh;
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
                if let Some(subscription) = self.shown().get(self.index) {
                    self.pending = Some((*subscription).clone());
                    self.message.clear();
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
        if let Some(subscription) = &self.pending {
            let parts = Layout::vertical([
                Constraint::Length(2),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(2),
            ])
            .split(area);
            frame.render_widget(
                Paragraph::new("Switch Azure subscription?").bold(),
                parts[0],
            );
            frame.render_widget(Paragraph::new(format!(
                "Name: {}\nTenant: {}\nSubscription: {}\n\nThis changes the default Azure CLI subscription for this config directory.",
                subscription.name, subscription.tenant, subscription.id,
            )).wrap(Wrap { trim: false }), parts[1]);
            frame.render_widget(
                Paragraph::new("y confirm   esc back   ctrl+c quit").bold(),
                parts[2],
            );
            frame.render_widget(
                Paragraph::new(self.message.as_str())
                    .fg(Color::Red)
                    .wrap(Wrap { trim: false }),
                parts[3],
            );
            return;
        }
        let parts = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(4),
            Constraint::Length(1),
            Constraint::Length(2),
        ])
        .split(area);
        frame.render_widget(
            Paragraph::new("Azure subscriptions · current cloud (* active)").bold(),
            parts[0],
        );
        frame.render_widget(Paragraph::new(format!("› {}", self.query)).bold(), parts[1]);
        let shown = self.shown();
        if shown.is_empty() {
            frame.render_widget(
                Paragraph::new(if self.subscriptions.is_empty() {
                    "No subscriptions available."
                } else {
                    "No matching subscriptions."
                }),
                parts[3],
            );
        } else {
            let rows = shown.iter().map(|subscription| {
                let row = Row::new(vec![
                    Cell::from(if subscription.current { "*" } else { " " }),
                    Cell::from(subscription.name.as_str()),
                    Cell::from(subscription.tenant.as_str()),
                    Cell::from(subscription.id.as_str()),
                ]);
                if subscription.current {
                    row.style(Style::default().fg(Color::Green))
                } else {
                    row
                }
            });
            let table = Table::new(
                rows,
                [
                    Constraint::Length(1),
                    Constraint::Percentage(40),
                    Constraint::Percentage(30),
                    Constraint::Percentage(30),
                ],
            )
            .header(Row::new(["", "Subscription", "Tenant", "ID"]).bold())
            .column_spacing(1)
            .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED));
            let visible = usize::from(parts[3].height.saturating_sub(1)).max(1);
            let top = self
                .index
                .saturating_sub(visible / 2)
                .min(shown.len().saturating_sub(visible));
            let mut state = TableState::default()
                .with_offset(top)
                .with_selected(Some(self.index));
            frame.render_stateful_widget(table, parts[3], &mut state);
            if let Some(subscription) = shown.get(self.index) {
                frame.render_widget(
                    Paragraph::new(format!(
                        "{}\nTenant: {}\nSubscription: {}",
                        subscription.name, subscription.tenant, subscription.id
                    ))
                    .wrap(Wrap { trim: false }),
                    parts[4],
                );
            }
        }
        frame.render_widget(
            Paragraph::new("type filter   enter select   esc clear/quit   ctrl+r refresh").dim(),
            parts[5],
        );
        frame.render_widget(
            Paragraph::new(self.message.as_str())
                .fg(Color::Red)
                .wrap(Wrap { trim: false }),
            parts[6],
        );
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
    let mut app = App::new();
    let mut screen = Screen::new()?;
    while !stopped.load(Ordering::Relaxed) {
        screen.0.draw(|frame| app.draw(frame))?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        if let Event::Key(key) = event::read()? {
            match app.key(key) {
                Action::Quit => break,
                Action::Refresh => {
                    app.message = "Refreshing subscriptions…".into();
                    screen.0.draw(|frame| app.draw(frame))?;
                    app.load(true);
                }
                Action::Switch(subscription) => match azure(&[
                    "account",
                    "set",
                    "--subscription",
                    &subscription.id,
                    "--output",
                    "none",
                    "--only-show-errors",
                ]) {
                    Ok(_) => break,
                    Err(error) => app.message = error,
                },
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
                "azctx - pick an Azure subscription in the current cloud\n\nType to filter names, subscription IDs or tenant IDs; Up/Down to move.\nEnter selects, y confirms switching, Esc cancels/clears/quits.\nCtrl+R refreshes subscriptions. Uses the existing az login; never signs in automatically."
            );
            return ExitCode::SUCCESS;
        }
        Some("-V" | "--version") => {
            println!("azctx {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some(arg) => {
            eprintln!("azctx: unexpected argument: {arg}");
            return ExitCode::FAILURE;
        }
        None => {}
    }
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("azctx: {error}");
            ExitCode::FAILURE
        }
    }
}
