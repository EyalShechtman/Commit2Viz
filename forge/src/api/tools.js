import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import api, { route, fetch } from "@forge/api";

// Load environment variables

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

/**
 * Helper: Get all Confluence pages with content
 */
const getAllConfluencePagesHelper = async () => {
  try {
    // Get Confluence page IDs from environment variable
    const pageIdsString = process.env.CONFLUENCE_PAGE_IDS || '491645/Eyal';
    const pageIds = pageIdsString.split(',').map(id => id.trim());
    const allPages = [];
    
    for (const pageId of pageIds) {
      try {
        const page = await getConfluencePage(pageId);
        allPages.push(page);
        console.log(`Fetched Confluence page: ${page.title}`);
      } catch (err) {
        console.error(`Error fetching Confluence page ${pageId}:`, err);
      }
    }
    
    return allPages;
  } catch (error) {
    console.error('Error fetching Confluence pages:', error);
    return [];
  }
};

/**
 * Helper: Get all Bitbucket files with content
 */
const getAllFilesHelper = async (workspaceId, repositoryId, branch, path = '') => {
  const urlPath = path ? `${path.replace(/\/$/, '')}/` : '';
  const routeUrl = route`/2.0/repositories/${workspaceId}/${repositoryId}/src/${branch}/${urlPath}`;

  let filesMap = {};

  const requestListing = async (target) => {
    const req = typeof target === 'string'
      ? await api.asApp().requestBitbucket(target)
      : await api.asApp().requestBitbucket(target);
    if (!req.ok) {
      throw new Error(`Failed to fetch directory listing - ${req.status}`);
    }
    return req.json();
  };

  const fetchFileContent = async (filePath) => {
    try {
      const fileUrl = route`/2.0/repositories/${workspaceId}/${repositoryId}/src/${branch}/${filePath}`;
      const res = await api.asApp().requestBitbucket(fileUrl);
      
      if (!res.ok) {
        return `[Error: Could not fetch file - status ${res.status}]`;
      }
      
      const content = await res.text();
      return content;
    } catch (err) {
      return `[Error: ${err.message}]`;
    }
  };

  let listing = await requestListing(routeUrl);

  while (listing) {
    for (const item of listing.values || []) {
      const name = item.path.split('/').pop();

      if (name.startsWith('.')) continue;

      if (item.type === 'commit_directory') {
        const nested = await getAllFilesHelper(workspaceId, repositoryId, branch, item.path);
        filesMap = { ...filesMap, ...nested };
      } else if (item.type === 'commit_file') {
        const content = await fetchFileContent(item.path);
        filesMap[item.path] = content;
      }
    }

    if (listing.next) {
      listing = await requestListing(listing.next);
    } else {
      break;
    }
  }

  return filesMap;
};

/**
 * Tool 1: Get All Confluence Pages
 * Returns all Confluence pages with their content and summaries
 */
export const getAllConfluencePagesTool = new DynamicStructuredTool({
  name: "get_all_confluence_pages",
  description: "Retrieves all Confluence documentation pages with their titles, IDs, content, and summaries. Use this to find relevant documentation for the user's question.",
  schema: z.object({}),
  func: async () => {
    try {
      const pages = await getAllConfluencePagesHelper();
      
      const summary = pages.map(page => ({
        id: page.id,
        title: page.title,
        spaceId: page.spaceId,
        content: page.body?.storage?.value?.substring(0, 500) + '...' || '[No content]',
        url: `${CONFLUENCE_URL.replace(/\/$/, '')}/wiki/spaces/${page.spaceId}/pages/${page.id}`
      }));
      
      return JSON.stringify({
        totalPages: pages.length,
        pages: summary
      }, null, 2);
    } catch (error) {
      return `Error fetching Confluence pages: ${error.message}`;
    }
  }
});

/**
 * Tool 2: Get All Bitbucket Files
 * Returns all files in the repository with their content
 */
export const getAllFilesTool = new DynamicStructuredTool({
  name: "get_all_bitbucket_files",
  description: "Retrieves all files from the Bitbucket repository with their content. Use this to explore the codebase, find specific files, or answer questions about the code structure.",
  schema: z.object({}),
  func: async () => {
    try {
      const workspaceId = process.env.BITBUCKET_WORKSPACE_ID || 'guyc12345';
      const repositoryId = process.env.BITBUCKET_REPOSITORY_ID || 'test';
      const branch = process.env.BITBUCKET_BRANCH || 'main';
      
      const filesMap = await getAllFilesHelper(workspaceId, repositoryId, branch);
      
      const fileList = Object.entries(filesMap).map(([path, content]) => ({
        path,
        size: content.length,
        preview: content.substring(0, 200) + '...'
      }));
      
      return JSON.stringify({
        totalFiles: fileList.length,
        repository: `${workspaceId}/${repositoryId}`,
        branch,
        files: fileList
      }, null, 2);
    } catch (error) {
      return `Error fetching Bitbucket files: ${error.message}`;
    }
  }
});

/**
 * Tool 3: Get All Jira Issues
 * Returns manually provided Jira issue data
 */
export const getAllJiraIssuesTool = new DynamicStructuredTool({
  name: "get_all_jira_issues",
  description: "Retrieves all Jira issues with their details including key, summary, status, assignee, and description. Use this to answer questions about bugs, tasks, and project status.",
  schema: z.object({}),
  func: async () => {
    try {
      // Manual data - you can replace this with actual data or API calls
      const issues = [
        // {
        //   key: "PROJ-1",
        //   summary: "Setup initial project structure",
        //   status: "Done",
        //   assignee: "John Doe",
        //   created: "2025-10-01",
        //   description: "Created the initial Forge app structure with UI Kit components"
        // },
        // {
        //   key: "PROJ-2",
        //   summary: "Implement Confluence integration",
        //   status: "In Progress",
        //   assignee: "Jane Smith",
        //   created: "2025-10-10",
        //   description: "Add ability to fetch and display Confluence pages in the app"
        // },
        // {
        //   key: "PROJ-3",
        //   summary: "Bug: Agent not responding to queries",
        //   status: "Open",
        //   assignee: "Unassigned",
        //   created: "2025-10-18",
        //   description: "The LangChain agent fails to respond when asked about documentation"
        // },
        // {
        //   key: "PROJ-4",
        //   summary: "Add Bitbucket file browser",
        //   status: "Done",
        //   assignee: "John Doe",
        //   created: "2025-10-15",
        //   description: "Implement recursive file listing from Bitbucket repository"
        // }
      ];
      
      return JSON.stringify({
        totalIssues: issues.length,
        issues
      }, null, 2);
    } catch (error) {
      return `Error fetching Jira issues: ${error.message}`;
    }
  }
});

// Export all tools as an array
export const allTools = [
  getAllConfluencePagesTool,
  getAllFilesTool,
  getAllJiraIssuesTool
];
