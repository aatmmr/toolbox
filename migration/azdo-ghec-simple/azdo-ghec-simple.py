import requests
from dotenv import load_dotenv
import os
import base64

load_dotenv()

azdo_org_url = os.getenv('AZDO_ORG_URL')
azdo_project = os.getenv('AZDO_PROJECT')
azdo_pat = os.getenv('AZDO_PAT')
github_token = os.getenv('GITHUB_TOKEN')
github_org = os.getenv('GITHUB_ORG')

# Add a string to filter repositories in name that are supposed to be mirrored.
# If kept as an empty string, all repositories will be mirrored.
repo_name_filter = "mod-"

# Add lower limit of repos to be mirrored. If kept as 0, all repositories will be mirrored.
repo_limit_lower = 0

# Add upper limit of repos to be mirrored. If kept as 0, all repositories will be mirrored.
repo_limit_upper = 5

pat_bytes = f":{azdo_pat}".encode('ascii')
base64_bytes = base64.b64encode(pat_bytes)
azdo_pat = base64_bytes.decode('ascii')

def get_azdo_repos(org_url, project, pat):
    url = f"{org_url}/{project}/_apis/git/repositories?api-version=7.1"

    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Basic {pat}'
    }
    
    response = requests.get(url, headers=headers)

    if response.status_code == 200 or response.status_code == 201 or response.status_code == 203:
        print("Successfully got repositories")
        return response.json()['value']
    else:
        print("Failed to get repositories: ", response.status_code)
        response.raise_for_status()

def filter_repos_by_name(repos, filter_str):
    return [repo for repo in repos if filter_str in repo['name']]

def github_repo_exists(repo_name, github_token, github_org):
    url = f"https://api.github.com/repos/{github_org}/{repo_name}"
    
    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        return True
    elif response.status_code == 404:
        return False
    else:
        print(f"Failed to check if repository {repo_name} exists on GitHub: ", response.status_code)
        response.raise_for_status()

def create_github_repo(repo_name, github_token, github_org):
    if github_repo_exists(repo_name, github_token, github_org):
        print(f"Repository {repo_name} already exists on GitHub - Skipping creation")
        return
    
    url = f"https://api.github.com/orgs/{github_org}/repos"
    
    
    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    data = {
        'name': repo_name,
        'private': True  # Set to False if you want the repository to be public
    }

    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 201:
        print(f"Successfully created repository {repo_name} on GitHub")
        return response.json()
    else:
        print(f"Failed to create repository {repo_name} on GitHub: ", response.status_code)
        response.raise_for_status()

def migrate_repo(azdo_repo_url, github_repo_url, azdo_pat, github_token):
    # Clone the Azure DevOps repository    
    if not os.path.exists('repo_temp'):
        os.makedirs('repo_temp')    
    
    azdo_clone_url = azdo_repo_url.replace('https://', f'https://{azdo_pat}@')
    os.system(f'git clone --mirror {azdo_clone_url} repo_temp')

    # Push the repository to GitHub
    github_repo_url = github_repo_url.replace('https://', f'https://{github_token}@')
    os.chdir('repo_temp')
    os.system(f'git remote set-url origin {github_repo_url}')
    os.system('git push --mirror')
    os.chdir('..')
    os.system('rm -rf repo_temp')

repositories = get_azdo_repos(azdo_org_url, azdo_project, azdo_pat)

if repo_name_filter:
    repositories = filter_repos_by_name(repositories, repo_name_filter)


if repositories:
    repo = repositories[0]
    print(repo['name'])
    print(repo['remoteUrl'])
    azdo_repo_url = repo['remoteUrl']
    github_repo_url = f"https://github.com/{github_org}/{repo['name']}.git"
    create_github_repo(repo['name'], github_token, github_org)
    migrate_repo(azdo_repo_url, github_repo_url, azdo_pat, github_token)
else:
    print("No repositories found")

