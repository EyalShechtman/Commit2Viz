import React, { useState } from 'react';
import ForgeReconciler, { Stack, Text, Textfield, Button, SectionMessage, Heading, Strong, Em, Link } from '@forge/react';
import { invoke } from '@forge/bridge';

// Component to render Markdown-like text as Forge UI components
const MarkdownText = ({ content }) => {
  if (!content) return null;

  // Split content into lines
  const lines = content.split('\n');
  const elements = [];
  let currentParagraph = [];

  const processLine = (line, index) => {
    // Headers (### or **)
    if (line.startsWith('### ') || line.startsWith('**') && line.endsWith('**')) {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }
      const headerText = line.replace(/^###\s*/, '').replace(/^\*\*|\*\*$/g, '');
      elements.push(
        <Heading key={`h-${index}`} size="small">{headerText}</Heading>
      );
      return;
    }

    // Links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    if (linkRegex.test(line)) {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }

      const parts = [];
      let lastIndex = 0;
      line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url, offset) => {
        // Add text before link
        if (offset > lastIndex) {
          parts.push(line.substring(lastIndex, offset));
        }
        // Add link
        parts.push(<Link key={`link-${index}-${offset}`} href={url}>{text}</Link>);
        lastIndex = offset + match.length;
        return match;
      });
      // Add remaining text
      if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex));
      }

      elements.push(
        <Text key={`link-line-${index}`}>{parts}</Text>
      );
      return;
    }

    // Bold text **text**
    if (line.includes('**')) {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }

      const parts = [];
      const segments = line.split(/(\*\*[^*]+\*\*)/g);
      segments.forEach((segment, i) => {
        if (segment.startsWith('**') && segment.endsWith('**')) {
          parts.push(
            <Strong key={`bold-${index}-${i}`}>
              {segment.replace(/^\*\*|\*\*$/g, '')}
            </Strong>
          );
        } else if (segment) {
          parts.push(segment);
        }
      });

      elements.push(
        <Text key={`bold-line-${index}`}>{parts}</Text>
      );
      return;
    }

    // Emoji bullets (👤, 📄, 💡, etc.)
    if (/^[👤📄💡🎯✨🚀-]\s/.test(line)) {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }
      elements.push(
        <Text key={`bullet-${index}`}>{line}</Text>
      );
      return;
    }

    // List items (-, *)
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }
      elements.push(
        <Text key={`list-${index}`}>{line}</Text>
      );
      return;
    }

    // Empty lines
    if (line.trim() === '') {
      if (currentParagraph.length > 0) {
        elements.push(
          <Text key={`p-${index}`}>{currentParagraph.join(' ')}</Text>
        );
        currentParagraph = [];
      }
      return;
    }

    // Regular text - accumulate into paragraph
    currentParagraph.push(line);
  };

  lines.forEach((line, index) => {
    processLine(line, index);
  });

  // Add any remaining paragraph
  if (currentParagraph.length > 0) {
    elements.push(
      <Text key={`p-final`}>{currentParagraph.join(' ')}</Text>
    );
  }

  return <Stack space="small">{elements}</Stack>;
};

const App = () => {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId] = useState('default'); // You can make this dynamic per user

  // Handler to chat with the agent
  const handleAskAgent = async () => {
    if (!question.trim()) {
      setError('Please enter a question');
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);
    
    try {
      console.log('Asking agent:', question);
      
      // Invoke the agent resolver
      const result = await invoke('chatWithAgent', { 
        input: question,
        sessionId: sessionId 
      });
      
      if (result.success) {
        setResponse(result.output);
        console.log('Agent response:', result.output);
      } else {
        setError(result.error || 'Failed to get response from agent');
      }
    } catch (err) {
      console.error('Error calling agent:', err);
      setError(err.message || 'Failed to communicate with agent');
    } finally {
      setLoading(false);
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !loading) {
      handleAskAgent();
    }
  };

  return (
    <Stack space="large" padding="large">
      
      <Text>Ask me about Jira issues, Confluence docs, or your codebase!</Text>
      
      <Textfield 
        value={question} 
        placeholder='Ask me anything about your project...' 
        onChange={e => setQuestion(e.target.value)}
        onKeyPress={handleKeyPress}
      />
      
      <Button 
        onClick={handleAskAgent} 
        isDisabled={loading || !question.trim()}
        appearance="primary"
      >
        {loading ? 'Thinking...' : 'Ask Agent'}
      </Button>
      
      {/* Display the agent response */}
      {response && (
        <SectionMessage appearance="success">
          <MarkdownText content={response} />
        </SectionMessage>
      )}
      
      {/* Display any errors */}
      {error && (
        <SectionMessage appearance="error">
          <Text>Error: {error}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
