use crate::Result;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[derive(Clone)]
pub struct Worktree {
    pub repo: PathBuf,
    pub path: PathBuf,
    pub branch: String,
    pub main: bool,
}

impl Worktree {
    pub fn name(&self) -> String {
        if self.main {
            format!(
                "{} (main)",
                if self.branch.is_empty() {
                    "main"
                } else {
                    &self.branch
                }
            )
        } else {
            basename(&self.path)
        }
    }
    pub fn label(&self) -> String {
        format!(
            "wt:{}/{}",
            basename(&self.repo),
            if self.main {
                if self.branch.is_empty() {
                    "main".into()
                } else {
                    self.branch.clone()
                }
            } else {
                basename(&self.path)
            }
        )
    }
}

pub fn basename(path: &Path) -> String {
    path.file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .into_owned()
}

pub fn git(repo: &Path, args: &[&str]) -> Result<Output> {
    Command::new("git")
        .current_dir(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("git: {error}"))
}

pub fn checked(output: Output) -> Result<String> {
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if message.is_empty() {
            format!("git exited {}", output.status)
        } else {
            message
        });
    }
    String::from_utf8(output.stdout).map_err(|_| "Git returned a non-UTF-8 path or response".into())
}

fn parse_worktrees(repo: &Path, text: &str) -> Result<Vec<Worktree>> {
    let mut rows = Vec::new();
    let mut path = None;
    let mut branch = String::new();
    let mut bare = false;
    for field in text.split('\0') {
        if let Some(value) = field.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
            branch.clear();
            bare = false;
        } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
            branch = value.to_owned();
        } else if field == "bare" {
            bare = true;
        } else if field.is_empty() {
            if let Some(path) = path.take() {
                if bare {
                    return Err("Bare repositories are not supported by wt".into());
                }
                let main = rows.is_empty();
                rows.push(Worktree {
                    repo: repo.to_owned(),
                    path,
                    branch: branch.clone(),
                    main,
                });
            }
        }
    }
    Ok(rows)
}

pub fn repository(start: &Path) -> Result<Option<PathBuf>> {
    if !start.is_dir() {
        return Ok(None);
    }
    let probe = git(start, &["rev-parse", "--git-common-dir"])?;
    if !probe.status.success() {
        return Ok(None);
    }
    let text = checked(git(start, &["worktree", "list", "--porcelain", "-z"])?)?;
    Ok(parse_worktrees(start, &text)?
        .first()
        .map(|tree| tree.path.clone()))
}

pub fn list(repo: &Path) -> Result<Vec<Worktree>> {
    parse_worktrees(
        repo,
        &checked(git(repo, &["worktree", "list", "--porcelain", "-z"])?)?,
    )
}

pub fn resolve(repo: &Path, name: &str) -> Result<Worktree> {
    let mut matches = list(repo)?.into_iter().filter(|tree| {
        basename(&tree.path) == name || tree.branch == name || tree.branch.replace('/', "-") == name
    });
    let found = matches.next().ok_or_else(|| {
        format!(
            "no worktree named '{name}' in {}; see: wt ls",
            basename(repo)
        )
    })?;
    if matches.next().is_some() {
        return Err(format!(
            "ambiguous worktree name '{name}'; use a unique branch or folder name"
        ));
    }
    Ok(found)
}

#[derive(Clone)]
pub enum State {
    Clean,
    Busy { dirty: usize, unpushed: usize },
    Missing,
    Error(String),
}

impl State {
    pub fn text(&self) -> String {
        match self {
            Self::Clean => "clean".into(),
            Self::Busy { dirty, unpushed } => format!("{dirty} uncommitted, {unpushed} unpushed"),
            Self::Missing => "missing (wt prune)".into(),
            Self::Error(error) => format!("error: {error}"),
        }
    }
}

fn counts(path: &Path) -> Result<(usize, usize)> {
    let output = git(path, &["status", "--porcelain=v1", "-z"])?;
    if !output.status.success() {
        checked(output)?;
        unreachable!();
    }
    let mut records = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut dirty = 0;
    while let Some(record) = records.next() {
        dirty += 1;
        if record
            .iter()
            .take(2)
            .any(|byte| *byte == b'R' || *byte == b'C')
        {
            records.next();
        }
    }
    let unpushed = checked(git(
        path,
        &["rev-list", "--count", "HEAD", "--not", "--remotes"],
    )?)?
    .trim()
    .parse()
    .map_err(|_| "Git returned an invalid unpushed-commit count")?;
    Ok((dirty, unpushed))
}

pub fn state(path: &Path) -> State {
    if !path.is_dir() {
        return State::Missing;
    }
    match counts(path) {
        Ok((0, 0)) => State::Clean,
        Ok((dirty, unpushed)) => State::Busy { dirty, unpushed },
        Err(error) => State::Error(error),
    }
}

fn ref_exists(repo: &Path, reference: &str) -> Result<bool> {
    let output = git(repo, &["show-ref", "--verify", "--quiet", reference])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => {
            checked(output)?;
            unreachable!();
        }
    }
}

pub fn create(
    repo: &Path,
    root: &Path,
    branch: &str,
    requested_base: Option<&str>,
) -> Result<(Worktree, Option<String>)> {
    if branch.is_empty() || branch.starts_with('-') {
        return Err(format!("invalid branch name: {branch}"));
    }
    checked(git(repo, &["check-ref-format", "--branch", branch])?)?;
    let path = root.join(basename(repo)).join(branch.replace('/', "-"));
    if fs::symlink_metadata(&path).is_ok() {
        return Err(format!(
            "{} already exists; use: wt go {}",
            path.display(),
            branch.replace('/', "-")
        ));
    }
    let path_arg = path.to_str().ok_or("Worktree path is not UTF-8")?;
    fs::create_dir_all(path.parent().ok_or("Missing worktree parent directory")?)
        .map_err(|error| error.to_string())?;
    let mut warning = None;
    let output = if ref_exists(repo, &format!("refs/heads/{branch}"))? {
        if requested_base.is_some() {
            return Err(format!("branch {branch} already exists; omit [base]"));
        }
        git(repo, &["worktree", "add", "--", path_arg, branch])?
    } else if requested_base.is_none()
        && ref_exists(repo, &format!("refs/remotes/origin/{branch}"))?
    {
        git(
            repo,
            &[
                "worktree",
                "add",
                "--track",
                "-b",
                branch,
                "--",
                path_arg,
                &format!("origin/{branch}"),
            ],
        )?
    } else {
        let base = if let Some(base) = requested_base {
            base.to_owned()
        } else {
            let default = git(
                repo,
                &[
                    "symbolic-ref",
                    "--quiet",
                    "--short",
                    "refs/remotes/origin/HEAD",
                ],
            )?;
            if default.status.success() {
                let default = checked(default)?.trim().to_owned();
                let fetch = git(
                    repo,
                    &[
                        "fetch",
                        "--quiet",
                        "origin",
                        default.strip_prefix("origin/").unwrap_or(&default),
                    ],
                )?;
                if !fetch.status.success() {
                    warning = Some(format!("fetch failed; branching from the local {default}"));
                }
                default
            } else {
                "HEAD".into()
            }
        };
        git(
            repo,
            &[
                "worktree",
                "add",
                "--no-track",
                "-b",
                branch,
                "--",
                path_arg,
                &base,
            ],
        )?
    };
    checked(output)?;
    Ok((
        Worktree {
            repo: repo.to_owned(),
            path,
            branch: branch.to_owned(),
            main: false,
        },
        warning,
    ))
}

pub fn remove(tree: &Worktree) -> Result<String> {
    if tree.main {
        return Err("refusing to remove the main worktree".into());
    }
    let cwd = env::current_dir().map_err(|error| error.to_string())?;
    let canonical = tree
        .path
        .canonicalize()
        .map_err(|error| format!("{}: {error}; run wt prune if missing", tree.path.display()))?;
    if cwd
        .canonicalize()
        .map_err(|error| error.to_string())?
        .starts_with(&canonical)
    {
        return Err(format!("leave {} first", tree.path.display()));
    }
    let (dirty, unpushed) = counts(&tree.path)?;
    if dirty != 0 {
        return Err(format!(
            "{} has {dirty} uncommitted file(s); commit or stash them first",
            tree.name()
        ));
    }
    if unpushed != 0 {
        return Err(format!(
            "{} has {unpushed} unpushed commit(s); push them first",
            tree.name()
        ));
    }
    // Git performs its own final dirty/locked check too. Never use --force.
    checked(git(
        &tree.repo,
        &[
            "worktree",
            "remove",
            "--",
            tree.path.to_str().ok_or("Worktree path is not UTF-8")?,
        ],
    )?)?;
    if let Some(parent) = tree.path.parent() {
        let _ = fs::remove_dir(parent);
    }
    let mut message = format!("removed worktree {}", tree.path.display());
    if !tree.branch.is_empty() {
        let result = git(&tree.repo, &["branch", "-d", "--", &tree.branch])?;
        if result.status.success() {
            message.push_str(&format!("\ndeleted merged branch {}", tree.branch));
        } else {
            message.push_str(&format!(
                "\nkept branch {} (not merged); delete it with: git branch -D {}",
                tree.branch, tree.branch
            ));
        }
    }
    Ok(message)
}

pub fn discover(start: &Path, root: &Path) -> Result<Vec<PathBuf>> {
    if let Some(repo) = repository(start)? {
        return Ok(vec![repo]);
    }
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries = |path: &Path| -> Result<Vec<PathBuf>> {
        let mut paths: Vec<_> = fs::read_dir(path)
            .map_err(|error| error.to_string())?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<_>>()
            .map_err(|error| error.to_string())?;
        paths.sort();
        Ok(paths)
    };
    let mut repos = Vec::new();
    for group in entries(root)? {
        if !group.is_dir() {
            continue;
        }
        for path in entries(&group)? {
            if !path.join(".git").is_file() {
                continue;
            }
            if let Some(repo) = repository(&path)? {
                if !repos.contains(&repo) {
                    repos.push(repo);
                }
            }
        }
    }
    Ok(repos)
}
