# Get Repository Admins

There might be occasions, where you want to get the list of teams that have the role `admin` of a single or a set of repositories in your organization or enterprise.

This Python script will fetch all teams of a given set of repos with a defined role. The default role is `admin`.

> [!TIP]
> This can also be used in a GitHub Action. In that case consider using a GitHub App instead of a Personal Access Token to authenticate with GitHub.

## Requirements

- Python
- Admin access to the repositories you want to fetch info for
- GitHub Personal Access Token with permission `repo` (all repo permissions)
- List of repositories you want to fetch info for

## How to Use

1. Install the required dependencies:

```bash
pip install -r requirements.txt
```

1. Create a `.env` file in the root directory of this script and add the personal access token:

```bash
PERSONAL_ACCESS_TOKEN=your_github_token
```

1. Set the desired repositories and permission in the script (lines `5` and `6`):

```python
repos = ["aatmmr/playground"]
role = 'admin'
```

1. Run the script:

```bash
python3 get-repository-admins.py
```

1. Copy the result data (JSON) from the terminal output and use it as needed.
