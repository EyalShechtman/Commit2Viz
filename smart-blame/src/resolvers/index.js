import Resolver from '@forge/resolver';

const resolver = new Resolver();

// Keep the original getText for backward compatibility
resolver.define('getText', (req) => {
  console.log(req);
  return 'Hello, world!';
});

// Chat with ChatGPT
resolver.define('chatWithGPT', async (req) => {
  const { message, conversationHistory = [] } = req.payload;

  // Get API key from Forge environment variables
  // Use: forge variables set OPENAI_API_KEY your-api-key
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return {
      error: true,
      message: 'OpenAI API key not configured. Please run: forge variables set OPENAI_API_KEY your-api-key'
    };
  }

  try {
    // Prepare messages for OpenAI API
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant embedded in a Bitbucket repository. Help developers with their code-related questions, repository analysis, and development tasks.'
      },
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    // Make request to OpenAI API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7,
          max_tokens: 800,
          stream: false
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });

      return {
        error: true,
        message: `API Error: ${response.status} - ${response.statusText}`,
        details: errorText
      };
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      return {
        error: true,
        message: 'Invalid response from OpenAI API'
      };
    }

    return {
      error: false,
      message: data.choices[0].message.content,
      role: 'assistant'
    };

  } catch (error) {
    console.error('Chat error:', error);
    return {
      error: true,
      message: error.name === 'AbortError'
        ? 'The request to ChatGPT timed out. Please try again.'
        : `Error communicating with ChatGPT: ${error.message}`
    };
  }
});

export const handler = resolver.getDefinitions();
