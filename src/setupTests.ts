import '@testing-library/jest-dom';

// Mock environment variables
process.env.NODE_ENV = 'test';

// Mock fetch globally
global.fetch = jest.fn();

// The browser-only mocks below are guarded so that node-environment test
// files (e.g. server-side integration tests using `@jest-environment node`)
// can share this setup without crashing on `window` references.
if (typeof window === 'undefined') {
  // Skip browser-only globals for node-env tests.
} else {
// Mock window.matchMedia for Radix UI components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
} // end browser-only guard

// Setup cleanup for React Query tests
afterEach(() => {
  jest.clearAllMocks();
});