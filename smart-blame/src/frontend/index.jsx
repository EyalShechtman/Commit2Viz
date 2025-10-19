import React, { useState } from 'react';
import ForgeReconciler, {
  Box,
  Text,
  TextArea,
  Button,
  Stack,
  Heading,
  Badge,
  Inline,
  xcss
} from '@forge/react';
import { invoke } from '@forge/bridge';

// Custom styles
const chatContainerStyle = xcss({
  height: '500px',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius',
  padding: 'space.200'
});

const messagesContainerStyle = xcss({
  flex: '1',
  overflowY: 'auto',
  paddingBottom: 'space.100',
  borderBottom: '1px solid',
  borderColor: 'color.border',
  marginBottom: 'space.200'
});

const messageBoxStyle = xcss({
  padding: 'space.150',
  marginBottom: 'space.100',
  borderRadius: 'border.radius',
  maxWidth: '100%'
});

const userMessageStyle = xcss({
  backgroundColor: 'color.background.brand.bold',
  color: 'color.text.inverse',
  marginLeft: 'space.400'
});

const assistantMessageStyle = xcss({
  backgroundColor: 'color.background.neutral.subtle',
  marginRight: 'space.400'
});

const inputContainerStyle = xcss({
  display: 'flex',
  gap: 'space.100'
});

const stopCardToggle = (event) => {
  event.stopPropagation();
};

const ChatApp = () => {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I\'m your AI assistant for this Bitbucket repository. How can I help you today?' }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');

    // Add user message to chat
    const newUserMessage = { role: 'user', content: userMessage };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Send message to backend
      const response = await invoke('chatWithGPT', {
        message: userMessage,
        conversationHistory: updatedMessages.slice(-10) // Keep last 10 messages for context
      });

      if (response.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${response.message}`,
          isError: true
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.message
        }]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      { role: 'assistant', content: 'Chat cleared. How can I help you?' }
    ]);
  };

  return (
    <Box
      xcss={chatContainerStyle}
      onClick={stopCardToggle}
      onMouseDownCapture={stopCardToggle}
      onMouseUpCapture={stopCardToggle}
      onFocusCapture={stopCardToggle}
    >
      <Stack space="space.200">
        {/* Header */}
        <Inline alignBlock="center" spread="space-between">
          <Heading as="h3">ChatGPT Assistant</Heading>
          <Button appearance="subtle" onClick={clearChat}>
            Clear Chat
          </Button>
        </Inline>

        {/* Messages Container */}
        <Box xcss={messagesContainerStyle}>
          <Stack space="space.100">
            {messages.map((message, index) => (
              <Box
                key={index}
                xcss={[
                  messageBoxStyle,
                  message.role === 'user' ? userMessageStyle : assistantMessageStyle
                ]}
              >
                <Stack space="space.050">
                  <Inline alignBlock="center">
                    <Badge appearance={message.role === 'user' ? 'primary' : 'default'}>
                      {message.role === 'user' ? 'You' : 'Assistant'}
                    </Badge>
                    {message.isError && (
                      <Badge appearance="removed">Error</Badge>
                    )}
                  </Inline>
                  <Text>
                    {message.content.split('\n').map((line, i) => (
                      <React.Fragment key={i}>
                        {line}
                        {i < message.content.split('\n').length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </Text>
                </Stack>
              </Box>
            ))}
            {isLoading && (
              <Box xcss={[messageBoxStyle, assistantMessageStyle]}>
                <Stack space="space.050">
                  <Badge appearance="default">Assistant</Badge>
                  <Text>Thinking...</Text>
                </Stack>
              </Box>
            )}
          </Stack>
        </Box>

        {/* Input Area */}
        <Stack space="space.100">
          <TextArea
            placeholder="Type your message here... (Press Enter to send, Shift+Enter for new line)"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            isDisabled={isLoading}
            rows={3}
          />
          <Inline alignBlock="center" spread="space-between">
            <Text size="small">
              {isLoading ? 'Processing...' : 'Ready to chat'}
            </Text>
            <Button
              appearance="primary"
              onClick={sendMessage}
              isDisabled={!inputMessage.trim() || isLoading}
            >
              Send Message
            </Button>
          </Inline>
        </Stack>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <ChatApp />
  </React.StrictMode>
);
