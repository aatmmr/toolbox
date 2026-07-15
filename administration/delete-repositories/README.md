# Delete Repositories

This script deletes a list of GitHub repositories. The repositories to delete are provided as a text file containing one repository URL per line. The script uses the GitHub REST API to delete each repository.

> [!WARNING]
> Deleting a repository is a destructive and irreversible action. Double-check the list of repositories before running the script, and consider running it with `DRY_RUN=true` first to verify what would be deleted.

## Usage

### Prepare Parameters

- `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) with the required permissions (`delete_repo`)
- `GITHUB_URL` (_Optional_): The URL of the GitHub API, e.g. a GitHub Enterprise Server URL
- `DRY_RUN` (_Optional_): Set to `true` to log which repositories would be deleted without actually deleting them. Alternatively, pass `--dry-run` as a command line argument (see examples below).
- `--confirm` (_Optional_, command line argument): Pause before each deletion and prompt for confirmation (`y`/`N`) before proceeding to the next repository.

### Prepare the Repository List

Create a text file with one repository URL per line, e.g. `repositories.txt`:

```text
https://github.com/owner/repository-one
https://github.com/owner/repository-two
```

Empty lines and lines starting with `#` are ignored.

### Use the Script

1. Run `npm i` in the root of the repository (installs all required dependencies)
2. Create a `.env` file next to the target script with the following content:

    ```env
    GITHUB_TOKEN=your_github_token
    ```

3. Run `node delete-repositories.js [path-to-repositories-file]` from this folder

    If no path is provided, the script defaults to `repositories.txt` in this folder.

4. The script will log the outcome (deleted, dry run, or error) for each repository in the list

### Examples

Delete the repositories listed in the default `repositories.txt` file in this folder:

```sh
node delete-repositories.js
```

Delete the repositories listed in a custom file:

```sh
node delete-repositories.js /path/to/my-repositories.txt
```

Preview which repositories would be deleted, without deleting them (dry run), using the `DRY_RUN` environment variable:

```sh
DRY_RUN=true node delete-repositories.js
```

Or equivalently, using the `--dry-run` command line flag:

```sh
node delete-repositories.js --dry-run
```

Combine a dry run with a custom file (the flag and file path can be given in any order):

```sh
node delete-repositories.js /path/to/my-repositories.txt --dry-run
```

Pause and ask for confirmation before deleting each repository:

```sh
node delete-repositories.js --confirm
```

Combine confirmation prompts with a dry run to preview and step through the list without deleting anything:

```sh
node delete-repositories.js --dry-run --confirm
```

Target a GitHub Enterprise Server instance instead of github.com by setting `GITHUB_URL` in `.env`:

```env
GITHUB_TOKEN=your_github_token
GITHUB_URL=https://github.example.com/api/v3
```

```sh
node delete-repositories.js
```
