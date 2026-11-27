use crate::{
    Result, rex,
    worktrees::{self, State, Worktree, basename},
};
use crossterm::{
    cursor::{Hide, Show},
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Frame, Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::Line,
    widgets::{Cell, Paragraph, Row, Table, TableState},
};
use std::{
    io::{self, Stdout},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

struct Job {
    generation: usize,
    index: usize,
    path: PathBuf,
}
struct Update {
    generation: usize,
    index: usize,
    state: State,
}
struct Pool {
    jobs: mpsc::Sender<Job>,
    updates: mpsc::Receiver<Update>,
    generation: Arc<AtomicUsize>,
}

impl Pool {
    fn new() -> Self {
        let (jobs, receiver) = mpsc::channel::<Job>();
        let receiver = Arc::new(Mutex::new(receiver));
        let (sender, updates) = mpsc::channel();
        let generation = Arc::new(AtomicUsize::new(0));
        for _ in 0..8 {
            let receiver = Arc::clone(&receiver);
            let sender = sender.clone();
            let generation = Arc::clone(&generation);
            thread::spawn(move || {
                loop {
                    let job = match receiver.lock() {
                        Ok(receiver) => receiver.recv(),
                        Err(_) => break,
                    };
                    let Ok(job) = job else {
                        break;
                    };
                    if job.generation != generation.load(Ordering::Relaxed) {
                        continue;
                    }
                    let state = worktrees::state(&job.path);
                    if sender
                        .send(Update {
                            generation: job.generation,
                            index: job.index,
                            state,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            });
        }
        Self {
            jobs,
            updates,
            generation,
        }
    }
}

struct Item {
    tree: Worktree,
    state: Option<State>,
}
struct App {
    repos: Vec<PathBuf>,
    root: PathBuf,
    rows: Vec<Item>,
    index: usize,
    generation: usize,
    pool: Pool,
    message: String,
    prompt: Option<String>,
}

impl App {
    fn new(start: &Path, root: &Path) -> Result<Self> {
        let mut app = Self {
            repos: worktrees::discover(start, root)?,
            root: root.to_owned(),
            rows: Vec::new(),
            index: 0,
            generation: 0,
            pool: Pool::new(),
            message: String::new(),
            prompt: None,
        };
        app.refresh(None)?;
        Ok(app)
    }

    fn refresh(&mut self, select: Option<&Path>) -> Result<()> {
        let mut rows = Vec::new();
        for repo in &self.repos {
            rows.extend(
                worktrees::list(repo)?
                    .into_iter()
                    .map(|tree| Item { tree, state: None }),
            );
        }
        self.generation = self.generation.wrapping_add(1);
        self.pool
            .generation
            .store(self.generation, Ordering::Relaxed);
        if let Some(path) = select {
            if let Some(index) = rows.iter().position(|item| item.tree.path == path) {
                self.index = index;
            }
        }
        self.index = self.index.min(rows.len().saturating_sub(1));
        self.rows = rows;
        for (index, item) in self.rows.iter().enumerate() {
            self.pool
                .jobs
                .send(Job {
                    generation: self.generation,
                    index,
                    path: item.tree.path.clone(),
                })
                .map_err(|_| "Worktree status workers stopped")?;
        }
        Ok(())
    }

    fn updates(&mut self) {
        for update in self.pool.updates.try_iter() {
            if update.generation == self.generation {
                if let Some(item) = self.rows.get_mut(update.index) {
                    item.state = Some(update.state);
                }
            }
        }
    }

    fn current(&self) -> Option<Worktree> {
        self.rows.get(self.index).map(|item| item.tree.clone())
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
            Constraint::Min(0),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(area);
        let title = if self.repos.len() == 1 {
            basename(&self.repos[0])
        } else {
            "all repos".into()
        };
        frame.render_widget(
            Paragraph::new(format!("Worktrees · {title}")).bold(),
            parts[0],
        );
        if self.rows.is_empty() {
            let message = if self.repos.is_empty() {
                format!(
                    "Not in a Git repository, and no worktrees under {}.",
                    self.root.display()
                )
            } else {
                "No worktrees found.".into()
            };
            frame.render_widget(Paragraph::new(message), parts[2]);
        } else {
            let multi = self.repos.len() > 1;
            let label = |item: &Item| {
                if multi {
                    format!("{}/{}", basename(&item.tree.repo), item.tree.name())
                } else {
                    item.tree.name()
                }
            };
            let name_width = self
                .rows
                .iter()
                .map(|item| label(item).chars().count())
                .max()
                .unwrap_or(10)
                .max(10);
            let branch_width = self
                .rows
                .iter()
                .map(|item| item.tree.branch.chars().count())
                .max()
                .unwrap_or(6)
                .max(10);
            let rows = self.rows.iter().map(|item| {
                let (colour, status) = match &item.state {
                    Some(State::Clean) => (Color::Green, "clean".to_owned()),
                    Some(state @ State::Busy { .. }) => (Color::Yellow, state.text()),
                    Some(state @ (State::Missing | State::Error(_))) => (Color::Red, state.text()),
                    None => (Color::Reset, "…".into()),
                };
                Row::new(vec![
                    Cell::from(label(item)),
                    Cell::from(if item.tree.branch.is_empty() {
                        "(detached)"
                    } else {
                        &item.tree.branch
                    }),
                    Cell::from(status).style(Style::default().fg(colour)),
                ])
            });
            let limit = usize::from(parts[2].width / 3);
            let table = Table::new(
                rows,
                [
                    Constraint::Length(name_width.min(limit) as u16),
                    Constraint::Length(branch_width.min(limit) as u16),
                    Constraint::Min(0),
                ],
            )
            .column_spacing(2)
            .highlight_symbol("› ")
            .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED));
            let visible = usize::from(parts[2].height).max(1);
            let top = self
                .index
                .saturating_sub(visible / 2)
                .min(self.rows.len().saturating_sub(visible));
            let mut selection = TableState::default()
                .with_offset(top)
                .with_selected(Some(self.index));
            frame.render_stateful_widget(table, parts[2], &mut selection);
        }
        frame.render_widget(
            Paragraph::new("enter open   ⌫ delete   n new   r refresh   q quit").dim(),
            parts[3],
        );
        if let Some(branch) = &self.prompt {
            let repo = self
                .current()
                .map(|tree| tree.repo)
                .or_else(|| self.repos.first().cloned());
            let label = repo.as_deref().map(basename).unwrap_or_default();
            let prompt = format!("New worktree in {label}, branch: {branch}");
            let cursor = Line::from(prompt.as_str()).width();
            frame.render_widget(Paragraph::new(prompt).bold(), parts[4]);
            if parts[4].width > 0 && parts[4].height > 0 {
                frame.set_cursor_position((
                    parts[4].x + cursor.min(usize::from(parts[4].width - 1)) as u16,
                    parts[4].y,
                ));
            }
        } else {
            frame.render_widget(Paragraph::new(self.message.as_str()).bold(), parts[4]);
        }
    }

    fn create(&mut self, branch: &str) -> Result<()> {
        let repo = self
            .current()
            .map(|tree| tree.repo)
            .or_else(|| self.repos.first().cloned())
            .ok_or("No repository to add a worktree to")?;
        let (tree, warning) = worktrees::create(&repo, &self.root, branch, None)?;
        self.message =
            rex::open(&tree, false)?.unwrap_or_else(|| format!("created {}", tree.path.display()));
        if let Some(warning) = warning {
            self.message.push_str(&format!("; {warning}"));
        }
        self.refresh(Some(&tree.path))
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

pub fn run(start: &Path, root: &Path) -> Result<Option<PathBuf>> {
    let stopped = Arc::new(AtomicBool::new(false));
    for signal in [
        signal_hook::consts::SIGINT,
        signal_hook::consts::SIGTERM,
        signal_hook::consts::SIGHUP,
    ] {
        signal_hook::flag::register(signal, Arc::clone(&stopped))
            .map_err(|error| error.to_string())?;
    }
    let mut app = App::new(start, root)?;
    let mut screen = Screen::new().map_err(|error| error.to_string())?;
    while !stopped.load(Ordering::Relaxed) {
        app.updates();
        screen
            .0
            .draw(|frame| app.draw(frame))
            .map_err(|error| error.to_string())?;
        if !event::poll(Duration::from_millis(100)).map_err(|error| error.to_string())? {
            continue;
        }
        let Event::Key(key) = event::read().map_err(|error| error.to_string())? else {
            continue;
        };
        if key.kind == KeyEventKind::Release {
            continue;
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            break;
        }
        if let Some(value) = app.prompt.as_mut() {
            match key.code {
                KeyCode::Esc => app.prompt = None,
                KeyCode::Backspace => {
                    value.pop();
                }
                KeyCode::Enter => {
                    let branch = app.prompt.take().unwrap_or_default().trim().to_owned();
                    if !branch.is_empty() {
                        app.message = format!("Creating {branch}…");
                        screen
                            .0
                            .draw(|frame| app.draw(frame))
                            .map_err(|error| error.to_string())?;
                        if let Err(error) = app.create(&branch) {
                            app.message = error;
                        }
                    }
                }
                KeyCode::Char(letter)
                    if !letter.is_control()
                        && !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    value.push(letter)
                }
                _ => {}
            }
            continue;
        }
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => break,
            KeyCode::Down | KeyCode::Char('j') => {
                app.index = (app.index + 1).min(app.rows.len().saturating_sub(1))
            }
            KeyCode::Up | KeyCode::Char('k') => app.index = app.index.saturating_sub(1),
            KeyCode::Char('r') => {
                app.message.clear();
                if let Err(error) = app.refresh(None) {
                    app.message = error;
                }
            }
            KeyCode::Char('n') => {
                if app.repos.is_empty() {
                    app.message = "No repository to add a worktree to.".into();
                } else {
                    app.prompt = Some(String::new());
                }
            }
            KeyCode::Enter => {
                if let Some(tree) = app.current() {
                    if !tree.path.is_dir() {
                        app.message = "Worktree is missing; run wt prune.".into();
                        continue;
                    }
                    match rex::open(&tree, true) {
                        Ok(Some(_)) => break,
                        Ok(None) => return Ok(Some(tree.path)),
                        Err(error) => app.message = error,
                    }
                }
            }
            KeyCode::Backspace | KeyCode::Delete => {
                if let Some(tree) = app.current() {
                    app.message = format!("Removing {}…", tree.name());
                    screen
                        .0
                        .draw(|frame| app.draw(frame))
                        .map_err(|error| error.to_string())?;
                    app.message = match crate::remove(&tree) {
                        Ok(message) => message,
                        Err(error) => error,
                    };
                    if let Err(error) = app.refresh(None) {
                        app.message = error;
                    }
                }
            }
            _ => {}
        }
    }
    Ok(None)
}
