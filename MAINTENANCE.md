# BashMaster Maintenance Guide

## Architecture

- **`bashmaster.html`**: Main entry point. Handles UI (HTML/CSS), gamification state, and DOM integration with `xterm.js`.
- **`src/engine/core.js`**: The heart of the platform.
    - `VirtualFS`: In-memory filesystem. Supports basic metadata (owner, permissions, mtime).
    - `Shell`: Command interpreter. Supports pipes, redirections, variable expansion, subshells, and basic control flow (`for`, `if`).
- **`src/engine/validator.js`**: Evaluation engine. Checks the state of the shell/FS against exercise rules.
- **`src/modules/curriculum.json`**: Educational content. Add modules and exercises here.

## How to Extend

### Adding a New Command
Edit `src/engine/core.js`. Add a new `case` to the `switch(cmd)` block in the `_execSingle` method.

### Adding an Exercise
Edit `src/modules/curriculum.json`. Each exercise needs:
- `task`: Description of the goal.
- `hint`: A simple hint.
- `solution`: The expected command (used for help and internal reference).
- `validation`: A rule for success (e.g., `file_exists`, `command_output_contains`).

### Validation Types
- `command_output_contains`: Checks if `stdout` includes specific text.
- `file_exists`: Checks if a file/dir exists in `VirtualFS`.
- `current_dir`: Checks if `cwd` matches.
- `alias_exists`: Checks if an alias is defined.
- `file_permissions`: Checks octal permissions.

## Deployment
This is a static platform. Simply upload the root files to any web host (GitHub Pages, Netlify, Vercel). No backend required.
