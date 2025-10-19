import { ChatOpenAI } from "@langchain/openai";
import { allTools } from './tools.js';

// Initialize OpenAI LLM
const llm = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
});

// Bind tools to LLM using bindTools method
const llmWithTools = llm.bindTools(allTools, { strict: true });

// Global memory store (in-memory, per session)
// Stores conversation history as an array of messages per session
const memoryStore = new Map();

/**
 * Get or create memory for a specific session/user
 */
const getMemoryForSession = (sessionId = 'default') => {
  if (!memoryStore.has(sessionId)) {
    memoryStore.set(sessionId, []);
  }
  return memoryStore.get(sessionId);
};

/**
 * Clear memory for a specific session
 */
export const clearMemory = (sessionId = 'default') => {
  memoryStore.delete(sessionId);
  console.log(`Memory cleared for session: ${sessionId}`);
};

/**
 * Execute a tool by name with arguments
 */
const executeTool = async (toolName, toolArgs) => {
  const tool = allTools.find(t => t.name === toolName);
  if (!tool) {
    return `Error: Tool ${toolName} not found`;
  }
  
  try {
    const result = await tool.func(toolArgs);
    return result;
  } catch (error) {
    return `Error executing tool ${toolName}: ${error.message}`;
  }
};

/**
 * Invoke the agent with a user query
 * 
 * @param {string} input - The user's question or command
 * @param {string} sessionId - Optional session ID for memory persistence (default: 'default')
 * @returns {Promise<object>} - Agent response with output and any tool results
 */
export const invokeAgent = async (input, sessionId = 'default') => {
  try {
    console.log(`[Agent] Processing input for session ${sessionId}: ${input}`);
    
    // Get conversation history for this session
    const conversationHistory = getMemoryForSession(sessionId);
    
    // Build system message
    const systemMessage = {
      role: "system",
      content: `You are an intelligent code copilot assistant for a software development team using Atlassian tools (Jira, Confluence, Bitbucket).

Your responsibilities:
1. Help users understand their codebase, issues, and documentation
2. Search for Jira issues, retrieve issue details, and provide insights about bugs, tasks, and projects
3. Access Confluence documentation pages and provide relevant information
4. Help users find information about pull requests, commits, and code structure
5. Answer questions about who worked on what, when issues were created/resolved, and project status

Available tools:
- get_all_bitbucket_files: Gets all repository files with content

CRITICAL INSTRUCTION: In EVERY response, you MUST:
1. Include relevant Confluence page links with explanations of why they're useful
2. Suggest team member contacts with their expertise areas and email addresses
3. Explain WHY each link or contact is relevant to the user's question

REPOSITORY & TEAM KNOWLEDGE BASE:

=== Commit2Viz Repository ===
📄 Main Page: https://uw-team-rcbm7f2u.atlassian.net/wiki/spaces/MFS/pages/65962/confluence+repo+test+page
Purpose: Strategic initiative to transform raw commit data into meaningful visualizations
- Provides stakeholders with insights into project development dynamics, trends, and patterns
- Empowers teams to monitor progress, identify bottlenecks, and celebrate achievements

Architecture:
- Data Extraction Module: Captures commit data with real-time updates
- Visualization Engine: Generates dynamic visual representations
- API Layer: Facilitates integration with external tools

Recent Fixes (2025):
- GitHub Actions workflow stability resolved
- Commit data extraction parsing algorithms refined
- API layer extended for better external tool support

Future Roadmap:
- Advanced analytics for commit trends
- Expanded visualization formats
- Improved UI design for easier navigation

Development Status: Active development phase

=== TEAM MEMBERS ===

👤 Maya (maya@uw.edu)
📄 Profile: https://uw-team-rcbm7f2u.atlassian.net/wiki/spaces/MFS/pages/557203/Maya
Role: Project oversight, task management, workflow coordination
Expertise: API call frequency planning, GitHub workflow monitoring, integration issues

Recent Activity (Oct 18-19, 2025):
- Organizing tasks in card format
- Planning API call frequency for Confluence updates
- Monitoring Eyal's GitHub workflow progress
- Tracking curl request debugging
- Clarifying error sources (GitHub vs Confluence)

Contact Maya for:
- Project planning and task coordination
- API integration strategy
- Workflow status updates
- Cross-team communication

👤 Eyal (eyal@uw.edu)
📄 Profile: https://uw-team-rcbm7f2u.atlassian.net/wiki/spaces/MFS/pages/491645/Eyal
Role: GitHub workflow development, Confluence API integration
Expertise: Automation, API implementation, curl requests, CI/CD workflows

Last Commit: 6ff3e331d4719ce8dcc7adf8988b33236f05c101
Commit Message: "fix for workflow"
Last Updated: 2025-10-19T15:40:17Z

Current Work (Oct 19, 2025):
- GitHub workflow development
- Confluence API integration for page ID retrieval
- Automated updates on PR/push to main branch
- Troubleshooting curl requests (currently facing "page not found" errors)
- Building bare bones test workflow

Contact Eyal for:
- GitHub Actions workflow questions
- Confluence API implementation details
- Curl request troubleshooting
- CI/CD automation setup
- Repository automation scripts

=== MEETING NOTES ===

📄 GitHub Workflow & Confluence Integration Meeting (Oct 18, 2025, 10:47 PM)
Link: https://uw-team-rcbm7f2u.atlassian.net/wiki/spaces/MFS/pages/491623/GitHub+Workflow+and+Confluence+Integration+Update+-+2025-10-18_22-47

Summary:
- Maya using Confluence APIs to pull current page ID for repository
- APIs will be called on PR/push to main to update Confluence files
- Eyal helping debug curl request issues
- "Page not found" error being investigated
- Discussion of API endpoints and tools being used

=== RESPONSE GUIDELINES ===

For EVERY response, you must:

1. ALWAYS include at least one relevant Confluence link with explanation:
   Example: "📄 For more details, see the [Commit2Viz documentation](https://uw-team-rcbm7f2u.atlassian.net/wiki/spaces/MFS/pages/65962/confluence+repo+test+page) which covers the architecture and recent workflow fixes."

2. ALWAYS suggest a team contact with explanation:
   Example: "👤 For workflow-specific questions, contact Eyal (eyal@uw.edu) as he's currently working on the GitHub Actions integration and can provide the latest updates on the curl request issues."

3. ALWAYS explain WHY the link/contact is relevant:
   Example: "This page is useful because it documents the exact error you're experiencing and includes the recent fix commit from Oct 19."

4. Format responses with clear sections:
   - Direct answer to the question
   - 📄 Relevant Confluence Links (with why they're helpful)
   - 👤 Suggested Contacts (with their expertise and why to contact them)
   - 💡 Additional Context (if applicable)

5. When mentioning team members, include:
   - Their name and email
   - Their Confluence profile link
   - Their area of expertise
   - Why they're the right person to contact

   `
    };
    
    // Add user message to history
    conversationHistory.push({
      role: "user",
      content: input
    });
    
    // Build messages array with history
    const messages = [
      systemMessage,
      ...conversationHistory
    ];
    
    // Call LLM with tools
    let response = await llmWithTools.invoke(messages);
    let iterations = 0;
    const maxIterations = 5;
    
    // Handle tool calls iteratively
    while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      console.log(`[Agent] Iteration ${iterations}: Processing ${response.tool_calls.length} tool calls`);
      
      // Add the assistant's message with tool_calls to the history
      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.tool_calls
      });
      
      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args;
        
        console.log(`[Agent] Calling tool: ${toolName}`, toolArgs);
        
        const toolResult = await executeTool(toolName, toolArgs);
        
        // Add tool result to messages
        messages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: toolCall.id
        });
      }
      
      // Call LLM again with tool results
      response = await llmWithTools.invoke(messages);
    }
    
    // Extract final response
    const finalResponse = response.content || 'I apologize, but I was unable to generate a response.';
    
    // Add assistant response to history
    conversationHistory.push({
      role: "assistant",
      content: finalResponse
    });
    
    // Keep only last 10 messages in history (5 exchanges) to manage memory
    if (conversationHistory.length > 10) {
      conversationHistory.splice(0, conversationHistory.length - 10);
    }
    
    console.log(`[Agent] Response: ${finalResponse}`);
    
    return {
      success: true,
      output: finalResponse,
      sessionId: sessionId
    };
    
  } catch (error) {
    console.error('[Agent] Error:', error);
    return {
      success: false,
      error: error.message,
      output: null
    };
  }
};

/**
 * Get the current chat history for a session
 */
export const getChatHistory = async (sessionId = 'default') => {
  const history = getMemoryForSession(sessionId);
  return history;
};
