import Resolver from '@forge/resolver';
import OpenAI from 'openai';
import api, { route, fetch } from "@forge/api";
import { invokeAgent, clearMemory, getChatHistory } from '../api/agent.js';
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const resolver = new Resolver();

// Initialize OpenAI client with API key
const openai = new OpenAI({

});

// -----------------------------------------------------------------------------
// Confluence API credentials
// -----------------------------------------------------------------------------

/**
 * getConfluencePage
 * Makes a GET call to fetch Confluence page content
 * 
 * Inputs:
 * - pageId: string Confluence page ID to fetch
 *
 * Output:
 * - Resolves to parsed JSON response body with page content
 */
const getConfluencePage = async (pageId) => {
  // Normalize base URL and build target endpoint with body-format query param
  const base = CONFLUENCE_URL.replace(/\/$/, '');
  const url = `${base}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;

  // Build Basic auth header from email:apiToken
  const auth = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`, 'utf8').toString('base64');

  // Perform the GET using Forge's fetch (egress domain must be allowed in manifest.yml)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    // Response wasn't JSON; keep raw text for diagnostics
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Confluence GET failed: ${res.status} ${res.statusText} - ${text?.slice(0, 1000)}`);
  }

  return json;
};

// Original getText resolver
resolver.define('getText', (req) => {
  console.log(req);
  return 'Hello, world!';
});

// Enhanced resolver to call OpenAI API with full repo and Confluence context
resolver.define('callOpenAI', async (req) => {
  try {
    // Extract the text content from the request payload
    const { text } = req.payload;
    
    console.log('Calling OpenAI with text:', text);
    console.log('Fetching all Bitbucket files and Confluence documentation...');
    
    // Fetch all repository files with their contents
    const workspaceId = 'guyc12345';
    const repositoryId = 'test';
    const branch = 'main';
    
    let repoFilesContext = '';
    try {
      const filesMap = await getAllFiles(workspaceId, repositoryId, branch, '');
      const fileCount = Object.keys(filesMap).length;
      console.log(`Fetched ${fileCount} files from repository`);
      
      // Build a context string with all files and their contents
      repoFilesContext = '\n\n=== REPOSITORY FILES ===\n';
      for (const [filePath, content] of Object.entries(filesMap)) {
        repoFilesContext += `\n--- File: ${filePath} ---\n${content}\n`;
      }
    } catch (err) {
      console.error('Error fetching repo files:', err);
      repoFilesContext = '\n\n[Note: Could not fetch repository files]';
    }
    
    // Fetch Confluence documentation page(s)
    const confluencePageIds = ['491638']; // Add more page IDs as needed
    let confluenceContext = '\n\n=== CONFLUENCE DOCUMENTATION ===\n';
    
    for (const pageId of confluencePageIds) {
      try {
        const confluencePage = await getConfluencePage(pageId);
        const pageUrl = `${CONFLUENCE_URL.replace(/\/$/, '')}/wiki/spaces/${confluencePage.spaceId || 'MFS'}/pages/${pageId}`;
        
        confluenceContext += `\n--- Confluence Page: ${confluencePage.title} ---\n`;
        confluenceContext += `URL: ${pageUrl}\n`;
        confluenceContext += `Author: ${confluencePage.authorId || 'Unknown'}\n`;
        confluenceContext += `Last Modified: ${confluencePage.version?.when || 'Unknown'}\n`;
        confluenceContext += `Content:\n${confluencePage.body?.storage?.value || '[No content]'}\n`;
        
        console.log(`Fetched Confluence page: ${confluencePage.title}`);
      } catch (err) {
        console.error(`Error fetching Confluence page ${pageId}:`, err);
        confluenceContext += `\n[Note: Could not fetch Confluence page ${pageId}]\n`;
      }
    }
    
    // Build the enhanced system prompt
    const systemPrompt = `You are an intelligent code copilot assistant that helps users understand and work with their Bitbucket repository.

Your responsibilities:
1. Help users learn about the codebase structure, files, and implementation details
2. Provide information about pull requests (PRs), commits, and who authored them
3. Reference relevant Confluence documentation when available
4. When citing Confluence docs, always include the page title, link, and author

You have access to:
- Complete repository file contents from workspace "${workspaceId}", repository "${repositoryId}", branch "${branch}"
- Confluence documentation pages with metadata

When answering questions:
- Cite specific files and line numbers when relevant
- If there's a useful Confluence doc, provide the link and mention the author
- Be helpful in teaching users about the repository structure and best practices
- Provide actionable insights about code, PRs, and commits

Context provided below:
${repoFilesContext}
${confluenceContext}`;

    // Make API call to OpenAI with enriched context
    const completion = await openai.chat.completions.create({
      model: 'gpt-4', // Using GPT-4 for better understanding of large context
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.7,
      max_tokens: 1000 // Increased for more detailed responses
    });
    
    // Extract the response text from OpenAI
    const response = completion.choices[0].message.content;
    
    console.log('OpenAI response:', response);
    
    return {
      success: true,
      response: response
    };
    
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

resolver.define("fetchRepository", async ({ context }) => {
  const workspaceId = 'guyc12345'; // Replace with your actual workspace ID
  const repositoryId = 'test' //context.extension.repository.uuid;

  console.log(`Fetching repository ${workspaceId}/${repositoryId}`)

  const res = await api
    .asApp()
    .requestBitbucket(route`/2.0/repositories/${workspaceId}/${repositoryId}`);

  return res.json();
});

// Resolver to fetch Confluence page content
// Usage: invoke('getConfluencePage', { pageId: '12345' })
resolver.define('getConfluencePage', async ({ payload }) => {
  const { pageId } = payload || {};
  if (!pageId) {
    return { success: false, error: 'pageId is required' };
  }
  try {
    const result = await getConfluencePage(pageId);
    console.log('=== CONFLUENCE PAGE CONTENT ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== PAGE TITLE ===');
    console.log(result.title);
    console.log('=== PAGE BODY CONTENT ===');
    console.log(result.body?.storage?.value);
    
    return { success: true, result };
  } catch (err) {
    console.error('Error fetching Confluence page:', err);
    return { success: false, error: err.message };
  }
});

/**
 * getAllFiles
 * Recursively list all files under a Bitbucket repository path using the
 * Bitbucket src API and fetch their contents. Handles pagination and skips 
 * hidden files/dirs starting with '.'.
 *
 * Inputs:
 * - workspaceId: workspace slug or id
 * - repositoryId: repository slug or id
 * - branch: branch name (e.g. 'main')
 * - path: path within the repo to list (optional)
 *
 * Returns an object where:
 *   - keys are file paths (strings)
 *   - values are file contents (strings)
 *   Example: { "src/index.js": "console.log('hello');", "README.md": "# Project" }
 */
const getAllFiles = async (workspaceId, repositoryId, branch = 'main', path = '') => {
  const urlPath = path ? `${path.replace(/\/$/, '')}/` : '';
  // Build the initial route URL for listing a directory
  const routeUrl = route`/2.0/repositories/${workspaceId}/${repositoryId}/src/${branch}/${urlPath}`;

  let filesMap = {};

  // Helper to request a given URL (route or full URL string)
  const requestListing = async (target) => {
    // target may be a string (full URL) or a route object
    const req = typeof target === 'string'
      ? await api.asApp().requestBitbucket(target)
      : await api.asApp().requestBitbucket(target);
    if (!req.ok) {
      throw new Error(`Failed to fetch directory listing for ${target} - ${req.status}`);
    }
    return req.json();
  };

  // Helper to fetch the raw content of a file
  const fetchFileContent = async (filePath) => {
    try {
      const fileUrl = route`/2.0/repositories/${workspaceId}/${repositoryId}/src/${branch}/${filePath}`;
      const res = await api.asApp().requestBitbucket(fileUrl);
      
      if (!res.ok) {
        console.warn(`Failed to fetch content for ${filePath}: ${res.status}`);
        return `[Error: Could not fetch file - status ${res.status}]`;
      }
      
      // Get the raw text content
      const content = await res.text();
      return content;
    } catch (err) {
      console.error(`Error fetching file ${filePath}:`, err);
      return `[Error: ${err.message}]`;
    }
  };

  // Start with the initial listing
  let listing = await requestListing(routeUrl);

  while (listing) {
    for (const item of listing.values || []) {
      const name = item.path.split('/').pop();

      // Skip hidden files/dirs
      if (name.startsWith('.')) continue;

      if (item.type === 'commit_directory') {
        // Recurse into the directory
        const nested = await getAllFiles(workspaceId, repositoryId, branch, item.path);
        // Merge nested files into the current map
        filesMap = { ...filesMap, ...nested };
      } else if (item.type === 'commit_file') {
        // Fetch the file content and add to map
        const content = await fetchFileContent(item.path);
        filesMap[item.path] = content;
      }
    }

    // Follow pagination
    if (listing.next) {
      // Bitbucket returns full next URL
      listing = await requestListing(listing.next);
    } else {
      break;
    }
  }

  return filesMap;
};

// Resolver: list all files under a repo path
// Usage: invoke('listBitbucketFiles', { workspaceId, repositoryId, branch, path })
resolver.define('listBitbucketFiles', async ({ payload }) => {
  const {
    workspaceId = 'guyc12345', // hardcoded default
    repositoryId = 'test',     // hardcoded default
    branch = 'main',
    path = ''
  } = payload || {};

  try {
    const files = await getAllFiles(workspaceId, repositoryId, branch, path);
    return { success: true, files };
  } catch (err) {
    console.error('Error listing Bitbucket files:', err);
    return { success: false, error: err.message };
  }
});


// Resolver: Invoke LangChain Agent
// Usage: invoke('chatWithAgent', { input: 'What are the recent bugs?', sessionId: 'user-123' })
resolver.define('chatWithAgent', async ({ payload }) => {
  const { input, sessionId } = payload || {};
  
  if (!input) {
    return { success: false, error: 'input is required', output: null };
  }
  
  try {
    console.log(`[Resolver] Invoking agent with input: ${input}`);
    
    const result = await invokeAgent(input, sessionId || 'default');
    
    if (result.success) {
      console.log(`[Resolver] Agent responded successfully`);
    }
    
    return result;
  } catch (err) {
    console.error('Error in chatWithAgent resolver:', err);
    return { success: false, error: err.message, output: null };
  }
});

// Resolver: Clear agent memory for a session
// Usage: invoke('clearAgentMemory', { sessionId: 'user-123' })
resolver.define('clearAgentMemory', async ({ payload }) => {
  const { sessionId } = payload || {};
  
  try {
    clearMemory(sessionId || 'default');
    return { success: true, message: `Memory cleared for session: ${sessionId || 'default'}` };
  } catch (err) {
    console.error('Error clearing agent memory:', err);
    return { success: false, error: err.message };
  }
});

// Resolver: Get chat history for a session
// Usage: invoke('getAgentChatHistory', { sessionId: 'user-123' })
resolver.define('getAgentChatHistory', async ({ payload }) => {
  const { sessionId } = payload || {};
  
  try {
    const history = await getChatHistory(sessionId || 'default');
    return { success: true, history };
  } catch (err) {
    console.error('Error getting chat history:', err);
    return { success: false, error: err.message, history: [] };
  }
});

export const handler = resolver.getDefinitions();
