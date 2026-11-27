mod rex;
mod ui;
mod worktrees;

use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::ExitCode,
};
use worktrees::{Worktree, basename};
pub type Result<T> = std::result::Result<T, String>;

const HELP: &str = "wt - Git worktrees under ~/worktrees (override WT_ROOT)
  wt new <branch> [base]     create and open a worktree
  wt ls                     list worktrees and their state
  wt go [--focus] <name>     open a Rex tab, or print its path
  wt rm <name>              remove a clean, fully pushed worktree
  wt prune                  forget missing worktrees
  wt ui [dir]               interactive worktree manager";

fn text(arg: &OsString) -> Result<&str> {
    arg.to_str().ok_or_else(|| "Argument is not UTF-8".into())
}

fn repo(cwd: &Path) -> Result<PathBuf> {
    worktrees::repository(cwd)?.ok_or_else(|| "not inside a git repository".into())
}

fn open(tree: &Worktree, focus: bool) -> Result<()> {
    if !tree.path.is_dir() {
        return Err(format!("{} is missing; run: wt prune", tree.path.display()));
    }
    match rex::open(tree, focus)? {
        Some(message) => eprintln!("{message}"),
        None => rex::print_path(&tree.path),
    }
    Ok(())
}

pub fn remove(tree: &Worktree) -> Result<String> {
    let mut message = worktrees::remove(tree)?;
    match rex::close(tree) {
        Ok(Some(closed)) => message.push_str(&format!("\n{closed}")),
        Err(error) => message.push_str(&format!(
            "\nworktree removed, but Rex cleanup failed: {error}"
        )),
        _ => {}
    }
    Ok(message)
}

fn run(args: &[OsString]) -> Result<()> {
    let cwd = env::current_dir().map_err(|error| error.to_string())?;
    let root = env::var_os("WT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("HOME").unwrap_or_default()).join("worktrees")
        });
    let root = if root.is_absolute() {
        root
    } else {
        cwd.join(root)
    };
    let command = args.first().map(text).transpose()?.unwrap_or("--help");
    let rest = &args[usize::from(!args.is_empty())..];
    match command {
        "-h" | "--help" | "help" if rest.is_empty() => println!("{HELP}"),
        "-V" | "--version" if rest.is_empty() => println!("wt {}", env!("CARGO_PKG_VERSION")),
        "new" if (1..=2).contains(&rest.len()) => {
            let repo = repo(&cwd)?;
            let (tree, warning) = worktrees::create(
                &repo,
                &root,
                text(&rest[0])?,
                rest.get(1).map(text).transpose()?,
            )?;
            if let Some(warning) = warning {
                eprintln!("{warning}");
            }
            open(&tree, false)?;
        }
        "ls" | "list" if rest.is_empty() => {
            for tree in worktrees::list(&repo(&cwd)?)? {
                println!(
                    "{:<32} {:<40} {}",
                    basename(&tree.path),
                    if tree.branch.is_empty() {
                        "(detached)"
                    } else {
                        &tree.branch
                    },
                    worktrees::state(&tree.path).text()
                );
            }
        }
        "go" => {
            let focus = rest
                .first()
                .is_some_and(|arg| arg == "--focus" || arg == "-f");
            let names = &rest[usize::from(focus)..];
            if names.len() != 1 {
                return Err("usage: wt go [--focus] <name>".into());
            }
            open(&worktrees::resolve(&repo(&cwd)?, text(&names[0])?)?, focus)?;
        }
        "rm" | "remove" if rest.len() == 1 => {
            eprintln!(
                "{}",
                remove(&worktrees::resolve(&repo(&cwd)?, text(&rest[0])?)?)?
            );
        }
        "prune" if rest.is_empty() => {
            print!(
                "{}",
                worktrees::checked(worktrees::git(
                    &repo(&cwd)?,
                    &["worktree", "prune", "--verbose"]
                )?)?
            );
        }
        "ui" if rest.len() <= 1 => {
            let start = rest.first().map(PathBuf::from).unwrap_or(cwd);
            if let Some(chosen) = ui::run(&start, &root)? {
                rex::print_path(&chosen);
            }
        }
        _ => return Err(format!("invalid command or arguments\n{HELP}")),
    }
    Ok(())
}

fn main() -> ExitCode {
    match run(&env::args_os().skip(1).collect::<Vec<_>>()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("wt: {error}");
            ExitCode::FAILURE
        }
    }
}
