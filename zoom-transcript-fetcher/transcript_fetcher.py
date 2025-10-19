#!/usr/bin/env python3

import os
import requests
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from root .env
load_dotenv()
load_dotenv('../.env')  # Also try parent directory

# Load environment variables (handled above via .env)

# Engineer name to Confluence page ID mapping
ENGINEER_PAGES = {
"GUY": "491638",
"EYAL": "491645",
"ARVIN": "98393",
"MAYA": "557203"
}

def get_zoom_access_token():
    """Get access token for Zoom API using Server-to-Server OAuth"""
    url = "https://zoom.us/oauth/token"
    data = {
        'grant_type': 'account_credentials',
        'account_id': os.getenv('ZOOM_ACCOUNT_ID')
    }

    response = requests.post(
        url,
        data=data,
        auth=(os.getenv('ZOOM_CLIENT_ID'), os.getenv('ZOOM_CLIENT_SECRET'))
    )

    if response.status_code == 200:
        return response.json()['access_token']
    else:
        print(f"Failed to get access token: {response.status_code}")
        print(response.text)
        return None

def get_meeting_transcript(access_token, meeting_id):
    """Fetch transcript for a specific meeting"""
    url = f"https://api.zoom.us/v2/meetings/{meeting_id}/recordings"

    headers = {
        'Authorization': f'Bearer {access_token}'
    }

    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        recordings = response.json()

        # Look for recordings with transcripts
        for recording in recordings['recording_files']:
            if recording['file_type'] == 'TRANSCRIPT':
                transcript_url = recording['download_url']

                # Download the transcript
                transcript_response = requests.get(transcript_url + '?access_token=' + access_token)
                return transcript_response.text

        print("No transcript found for this meeting")
        return None
    else:
        print(f"Failed to get recordings: {response.status_code}")
        print(response.text)
        return None

def get_active_sprint(project_key):
    """Get the currently active sprint for a project"""
    base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/')
    if base_url.endswith('/wiki'):
        base_url = base_url[:-5]

    email = os.getenv('CONFLUENCE_EMAIL')
    token = os.getenv('CONFLUENCE_API_TOKEN')

    # Try to get sprint from board 2 (from the URL you provided)
    board_id = 2  # From your board URL: /boards/2

    # Get active sprints for this board
    sprint_url = f"{base_url}/rest/agile/1.0/board/{board_id}/sprint"
    sprint_params = {'state': 'active'}
    sprint_response = requests.get(sprint_url, params=sprint_params, auth=(email, token))

    if sprint_response.status_code == 200:
        sprints = sprint_response.json().get('values', [])
        if sprints:
            active_sprint = sprints[0]
            sprint_id = active_sprint['id']
            print(f"✅ Found active sprint: {active_sprint['name']} (ID: {sprint_id})")
            return sprint_id

    print("⚠️  No active sprint found")
    print("   Tip: Check your board has an active sprint at:")
    print(f"   {base_url}/jira/software/projects/{project_key}/boards/{board_id}")
    return None

def generate_meeting_summary_with_openai(transcript_text):
    """Call OpenAI to generate a concise meeting summary and action items with assignees.

    Expects OPENAI_API_KEY in environment. Returns dict with 'title', 'summary_html', and 'action_items'
    suitable for Confluence storage and Jira ticket creation.
    """
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        return {
            'title': 'Meeting Summary & Transcript',
            'summary_html': "<p><em>OPENAI_API_KEY not set; skipping AI summary.</em></p>",
            'action_items': []
        }

    try:
        # Minimal Chat Completions call via requests to avoid extra deps
        resp = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'gpt-4o-mini',
                'messages': [
                    {
                        'role': 'system',
                        'content': (
                            'You are an assistant that generates concise, actionable '
                            'meeting summaries and highlights from transcripts. '
                            'First, create a concise title for the meeting based on the main topic. '
                            'Then provide a meeting summary with key decisions. '
                            'Finally, extract specific actionable items that can become Jira tickets. '
                            'IMPORTANT: For each action item, identify WHO should do it based on the transcript. '
                            'Return in this exact format:\n\n'
                            'TITLE: [Your title here]\n\n'
                            'SUMMARY:\n[HTML content using only simple tags like <p>, <ul>, <li>, <h3>, <strong>]\n\n'
                            'ACTION ITEMS:\n'
                            '1. [Specific actionable task] | ASSIGNEE: [Person\'s name from transcript]\n'
                            '2. [Another specific actionable task] | ASSIGNEE: [Person\'s name from transcript]\n'
                            '...\n\n'
                            'Note: Use the exact names as they appear in the transcript (e.g., "Maya", "Eyal").'
                        )
                    },
                    {
                        'role': 'user',
                        'content': (
                            'Analyze the transcript below and provide:\n'
                            '1. A concise title for the meeting\n'
                            '2. A short meeting summary with key decisions\n'
                            '3. A numbered list of specific actionable items (things that need to be done)\n\n'
                            f'Transcript:\n{transcript_text}'
                        )
                    }
                ],
                'temperature': 0.3,
            },
            timeout=60
        )
        if resp.status_code == 200:
            data = resp.json()
            content = data['choices'][0]['message']['content']

            # Parse the response to extract title, summary, and action items
            lines = content.split('\n')
            title = 'Meeting Summary & Transcript'  # default
            summary_html = content  # default to full content
            action_items = []

            # Parse sections
            current_section = None
            summary_lines = []
            action_lines = []

            for line in lines:
                line_stripped = line.strip()
                if line_stripped.upper().startswith('TITLE:'):
                    title = line_stripped[6:].strip()
                    current_section = 'title'
                elif line_stripped.upper().startswith('SUMMARY:'):
                    current_section = 'summary'
                elif line_stripped.upper().startswith('ACTION ITEMS:'):
                    current_section = 'actions'
                elif current_section == 'summary' and line_stripped:
                    summary_lines.append(line)
                elif current_section == 'actions' and line_stripped:
                    # Extract action item text and assignee (remove numbering)
                    if line_stripped[0].isdigit() or line_stripped.startswith('-'):
                        # Remove numbering like "1. " or "1) " or "- "
                        action_text = line_stripped
                        if '. ' in action_text:
                            action_text = action_text.split('. ', 1)[-1]
                        elif ') ' in action_text:
                            action_text = action_text.split(') ', 1)[-1]
                        action_text = action_text.lstrip('- ').lstrip('* ').strip()
                        
                        # Parse assignee if present
                        assignee = None
                        if '| ASSIGNEE:' in action_text or '|ASSIGNEE:' in action_text:
                            parts = action_text.split('|')
                            action_text = parts[0].strip()
                            assignee_part = parts[1].strip()
                            if assignee_part.upper().startswith('ASSIGNEE:'):
                                assignee = assignee_part[9:].strip()
                        
                        if action_text:
                            action_items.append({
                                'task': action_text,
                                'assignee': assignee
                            })

            if summary_lines:
                summary_html = '\n'.join(summary_lines).strip()

            return {
                'title': title,
                'summary_html': summary_html,
                'action_items': action_items
            }
        else:
            return {
                'title': 'Meeting Summary & Transcript',
                'summary_html': f"<p><em>OpenAI summary request failed: {resp.status_code} - {resp.text}</em></p>",
                'action_items': []
            }
    except Exception as e:
        return {
            'title': 'Meeting Summary & Transcript',
            'summary_html': f"<p><em>OpenAI summary error: {e}</em></p>",
            'action_items': []
        }


def format_transcript_for_confluence(transcript_text, ai_result):
    """Format transcript into nice Confluence page content"""
    # Use AI-generated title and summary
    title = ai_result['title']
    summary_html = ai_result['summary_html']

    # Create Confluence page content (without full transcript)
    page_content = f"""<h1>{title}</h1>

<h2>Summary</h2>
{summary_html}

<p><em>Generated on {datetime.now().strftime('%B %d, %Y at %I:%M %p')}</em></p>"""

    return page_content

def find_valid_parent_pages(space_key, conf_email, conf_token, base_url):
    """Find valid parent pages in the space that we can create pages under"""
    print("🔍 Finding valid parent pages...")

    # Get recent pages from the space
    search_url = f"{base_url}/wiki/rest/api/content/search"
    params = {
        'cql': f'space={space_key} AND type=page',
        'limit': 10,
        'expand': 'ancestors'
    }

    response = requests.get(search_url, params=params, auth=(conf_email, conf_token))

    if response.status_code == 200:
        data = response.json()
        pages = data.get('results', [])

        print(f"📄 Found {len(pages)} pages in space {space_key}:")
        for page in pages:
            page_id = page['id']
            title = page['title']
            print(f"   ID: {page_id} - Title: {title}")

            # Check if we can create pages under this parent
            test_data = {
                "type": "page",
                "title": f"Test Page - {page_id}",
                "space": {"key": space_key},
                "ancestors": [{"id": int(page_id)}],
                "body": {
                    "storage": {
                        "value": "<p>Test</p>",
                        "representation": "storage"
                    }
                }
            }

            create_url = f"{base_url}/wiki/rest/api/content"
            test_response = requests.post(create_url, headers={'Content-Type': 'application/json'},
                                        json=test_data, auth=(conf_email, conf_token))

            if test_response.status_code in [200, 201]:
                # Delete the test page
                test_page_data = test_response.json()
                test_page_id = test_page_data['id']
                delete_url = f"{base_url}/wiki/rest/api/content/{test_page_id}"
                requests.delete(delete_url, auth=(conf_email, conf_token))

                print(f"   ✅ Can create pages under: {page_id} - {title}")
                return page_id
            else:
                print(f"   ❌ Cannot create under: {page_id} - Status: {test_response.status_code}")

    return None

def get_jira_user_by_name(name):
    """Find Jira user account ID by searching for their name"""
    base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/')
    if base_url.endswith('/wiki'):
        base_url = base_url[:-5]
    
    email = os.getenv('CONFLUENCE_EMAIL')
    token = os.getenv('CONFLUENCE_API_TOKEN')
    
    # Search for user by name
    search_url = f"{base_url}/rest/api/3/user/search"
    params = {'query': name}
    response = requests.get(search_url, params=params, auth=(email, token))
    
    if response.status_code == 200:
        users = response.json()
        if users:
            # Return the first match's account ID
            return users[0]['accountId']
    
    return None

def create_jira_ticket(summary, description, project_key="DUB", issue_type="Task", assignee_name=None, sprint_id=None):
    """Create a Jira ticket using the same Atlassian credentials as Confluence"""
    base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/')
    if base_url.endswith('/wiki'):
        base_url = base_url[:-5]

    url = f"{base_url}/rest/api/3/issue"
    email = os.getenv('CONFLUENCE_EMAIL')
    token = os.getenv('CONFLUENCE_API_TOKEN')

    data = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": description}]
                }]
            },
            "issuetype": {"name": issue_type}
        }
    }

    # Find and assign user by name
    if assignee_name:
        account_id = get_jira_user_by_name(assignee_name)
        if account_id:
            data["fields"]["assignee"] = {"accountId": account_id}
            print(f"   👤 Assigning to: {assignee_name}")
        else:
            print(f"   ⚠️  Could not find user: {assignee_name}, leaving unassigned")

    # Note: Sprint assignment disabled due to field configuration issues
    # User can manually move tickets to sprint after creation
    # if sprint_id:
    #     data["fields"]["customfield_10020"] = int(sprint_id)

    response = requests.post(url, headers={'Content-Type': 'application/json'},
                           json=data, auth=(email, token))

    if response.status_code in [200, 201]:
        issue_data = response.json()
        issue_key = issue_data['key']
        print(f"✅ Created Jira ticket: {base_url}/browse/{issue_key}")
        return issue_data
    else:
        print(f"❌ Failed to create Jira ticket: {response.status_code}")
        print(f"   {response.text[:200]}")
        return None

def update_engineer_pages(transcript, meeting_title):
    """Update engineer Confluence pages with their contributions from meeting"""
    if not ENGINEER_PAGES:
        return
    
    base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/').replace('/wiki', '')
    email = os.getenv('CONFLUENCE_EMAIL')
    token = os.getenv('CONFLUENCE_API_TOKEN')
    api_key = os.getenv('OPENAI_API_KEY')
    
    if not api_key:
        return
    
    date = datetime.now().strftime('%B %d, %Y')
    
    for name, page_id in ENGINEER_PAGES.items():
        # Extract contributions with OpenAI
        resp = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': 'gpt-4o-mini',
                'messages': [
                    {'role': 'system', 'content': f'Extract {name}\'s contributions as a bullet list. Return "NONE" if not mentioned.'},
                    {'role': 'user', 'content': f'What did {name} contribute in this meeting?\n\n{transcript}'}
                ],
                'temperature': 0.3
            },
            timeout=60
        )
        
        if resp.status_code != 200 or 'NONE' in resp.json()['choices'][0]['message']['content']:
            continue
        
        contributions = resp.json()['choices'][0]['message']['content']
        
        # Get current page
        page_resp = requests.get(f"{base_url}/wiki/api/v2/pages/{page_id}?body-format=storage", auth=(email, token))
        if page_resp.status_code != 200:
            continue
        
        page = page_resp.json()
        current_body = page.get('body', {}).get('storage', {}).get('value', '')
        version = page.get('version', {}).get('number', 1)
        
        # Append new section
        new_section = f"\n<h3>{meeting_title} - {date}</h3>\n{contributions}\n"
        updated_body = current_body + new_section
        
        # Update page
        requests.put(
            f"{base_url}/wiki/api/v2/pages/{page_id}",
            headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
            json={
                "id": page_id,
                "status": "current",
                "title": page.get('title', ''),
                "body": {"representation": "storage", "value": updated_body},
                "version": {"number": version + 1}
            },
            auth=(email, token)
        )
        print(f"✅ Updated {name}'s page")

def create_confluence_page(title, content):
    """Create a new Confluence page"""
    url = f"{os.getenv('CONFLUENCE_URL')}/wiki/rest/api/content"

    headers = {
        'Content-Type': 'application/json'
    }

    # Use Basic auth with email + API token for Confluence Cloud
    conf_email = os.getenv('CONFLUENCE_EMAIL')
    conf_token = os.getenv('CONFLUENCE_API_TOKEN')
    space_key = os.getenv('CONFLUENCE_SPACE_KEY')
    parent_page_id = os.getenv('CONFLUENCE_PARENT_PAGE_ID', '491523')

    # Fix double /wiki/ issue
    base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/')
    if base_url.endswith('/wiki'):
        base_url = base_url[:-5]  # Remove /wiki if it exists

    url = f"{base_url}/wiki/rest/api/content"

    print(f"🔍 Debug info:")
    print(f"   Base URL: {base_url}")
    print(f"   Full URL: {url}")
    print(f"   Space: {space_key}")
    print(f"   Parent Page ID: {parent_page_id}")
    print(f"   Email: {conf_email}")

    # Try to create page at space root first (no parent needed)
    data = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "body": {
            "storage": {
                "value": content,
                "representation": "storage"
            }
        }
    }

    print(f"📝 Creating page at space root...")
    response = requests.post(url, headers=headers, json=data, auth=(conf_email, conf_token))

    # If space root creation fails, try with parent page
    if response.status_code not in [200, 201]:
        print(f"⚠️  Space root creation failed ({response.status_code}), trying with parent page...")
        
        # Try to find a valid parent page automatically
        valid_parent = find_valid_parent_pages(space_key, conf_email, conf_token, base_url)

        if valid_parent:
            parent_page_id = valid_parent
            print(f"✅ Using parent page: {parent_page_id}")
            
            # Add ancestors and retry
            data["ancestors"] = [{"id": int(parent_page_id)}]
            print(f"📝 Retrying with parent page...")
            response = requests.post(url, headers=headers, json=data, auth=(conf_email, conf_token))
        else:
            print("❌ No valid parent pages found. Please check your space permissions.")
            return None

    if response.status_code in [200, 201]:
        page_data = response.json()
        page_url = page_data['_links']['webui']
        # Fix double /wiki/ if present
        if page_url.startswith('/wiki/'):
            full_url = f"{base_url}{page_url}"
        else:
            full_url = f"{base_url}/wiki{page_url}"
        print(f"✅ Created Confluence page: {full_url}")
        return page_data
    else:
        print(f"❌ Failed to create Confluence page: {response.status_code}")
        print(response.text)
        return None

def main():
    # Load the manually fetched transcript
    transcript_file = "../Zoom_Audio.transcript.txt"

    print(f"📄 Reading transcript from {transcript_file}...")
    with open(transcript_file, "r", encoding="utf-8") as f:
        transcript = f.read().strip()

    if not transcript:
        print("❌ Transcript file is empty")
        return

    print(f"✅ Loaded transcript ({len(transcript)} characters)")

    print(f"🤖 Generating title and summary with OpenAI...")

    # Generate title and summary via OpenAI
    ai_result = generate_meeting_summary_with_openai(transcript)
    print(f"✅ Generated title: '{ai_result['title']}'")
    print(f"📝 Found {len(ai_result['action_items'])} action items")

    # Format for Confluence using AI-generated title and summary
    confluence_content = format_transcript_for_confluence(transcript, ai_result)
    if not confluence_content:
        print("❌ Failed to format transcript")
        return

    print(f"✅ Formatted content for Confluence")

    # Create unique title with timestamp to avoid duplicates
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M')
    unique_title = f"{ai_result['title']} - {timestamp}"

    # Create Confluence page using AI-generated title with timestamp
    print(f"📤 Uploading to Confluence...")
    confluence_result = create_confluence_page(unique_title, confluence_content)

    if confluence_result:
        print("✅ Successfully uploaded to Confluence!")
        # Get full URL for the Confluence page
        base_url = os.getenv('CONFLUENCE_URL', '').rstrip('/')
        if base_url.endswith('/wiki'):
            base_url = base_url[:-5]
        confluence_link = f"{base_url}/wiki{confluence_result.get('_links', {}).get('webui', '')}"
    else:
        print("❌ Failed to upload to Confluence")
        confluence_link = 'N/A'

    # Create Jira tickets for action items using LLM-extracted tasks
    if ai_result['action_items']:
        print(f"\n🎫 Creating Jira tickets for {len(ai_result['action_items'])} action items...")

        project_key = os.getenv('JIRA_PROJECT_KEY', 'DUB')
        
        # Sprint assignment temporarily disabled - manual assignment recommended
        # sprint_id = os.getenv('JIRA_SPRINT_ID')
        # if not sprint_id:
        #     sprint_id = get_active_sprint(project_key)
        sprint_id = None

        created_tickets = []
        for i, action_item in enumerate(ai_result['action_items'], 1):
            task = action_item['task']
            assignee = action_item.get('assignee')
            
            # Create concise summary (max 100 chars for Jira)
            ticket_summary = task[:97] + '...' if len(task) > 100 else task
            
            # Create detailed description with context
            ticket_description = (
                f"Action item from meeting: {ai_result['title']}\n\n"
                f"Task: {task}\n\n"
                f"Meeting notes: {confluence_link}"
            )
            
            print(f"   Creating ticket {i}/{len(ai_result['action_items'])}: {ticket_summary}")
            
            ticket_result = create_jira_ticket(
                summary=ticket_summary,
                description=ticket_description,
                project_key=project_key,
                assignee_name=assignee,
                sprint_id=sprint_id
            )
            
            if ticket_result:
                created_tickets.append(ticket_result['key'])
            else:
                print(f"   ⚠️  Failed to create ticket for action item {i}")
        
        if created_tickets:
            print(f"\n✅ Created {len(created_tickets)} Jira tickets: {', '.join(created_tickets)}")
    else:
        print("\nℹ️  No action items found - no Jira tickets created")

    # Update engineer pages
    if ENGINEER_PAGES:
        print(f"\n📝 Updating {len(ENGINEER_PAGES)} engineer page(s)...")
        update_engineer_pages(transcript, ai_result['title'])

    print("\n✅ Done!")

if __name__ == "__main__":
    main()
