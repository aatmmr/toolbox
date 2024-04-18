import requests
from dotenv import load_dotenv
import os

repos = ["aatmmr/playground"]
role = 'admin'

def get_repo_teams(repo_full_name, role='admin'):
    load_dotenv()

    headers = {'Authorization': f'token {os.getenv("PERSONAL_ACCESS_TOKEN")}'}
    response = requests.get(f"https://api.github.com/repos/{repo_full_name}/teams", headers=headers)
    teams = response.json()

    result = [team for team in teams if team['permission'] == role]

    return result

repo_teams = {}

for repo in repos:
    teams = get_repo_teams(repo, role=role)
    repo_teams[repo] = teams

print(repo_teams)