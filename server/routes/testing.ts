import express from 'express';
import { spawn } from 'child_process';
import { requireRole } from '../replitAuth';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Get list of all test files and their descriptions
router.get('/test-files', requireRole(['super_admin']), async (req, res) => {
  try {
    const testFiles = [];
    
    // Scan test directories
    const testDirs = [
      'client/src/__tests__/components',
      'client/src/__tests__/pages', 
      'client/src/__tests__/integration',
      'server/__tests__',
      'shared/__tests__'
    ];

    for (const dir of testDirs) {
      try {
        const files = await fs.readdir(dir);
        const testFileList = files.filter(file => file.endsWith('.test.tsx') || file.endsWith('.test.ts'));
        
        for (const file of testFileList) {
          const filePath = path.join(dir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          
          // Extract test descriptions from describe blocks
          const describeMatches = content.match(/describe\(['"`]([^'"`]+)['"`]/g);
          const testMatches = content.match(/it\(['"`]([^'"`]+)['"`]/g);
          
          testFiles.push({
            name: file,
            path: filePath,
            category: dir.split('/').pop(),
            describes: describeMatches?.map(m => m.match(/['"`]([^'"`]+)['"`]/)?.[1]) || [],
            tests: testMatches?.map(m => m.match(/['"`]([^'"`]+)['"`]/)?.[1]) || [],
            testCount: testMatches?.length || 0
          });
        }
      } catch (error) {
        console.log(`Directory ${dir} not found, skipping`);
      }
    }

    res.json(testFiles);
  } catch (error) {
    console.error('Error reading test files:', error);
    res.status(500).json({ error: 'Failed to read test files' });
  }
});

// Run specific test file or all tests via Server-Sent Events
router.get('/run-tests', requireRole(['super_admin']), (req, res) => {
  const { testFile, coverage } = req.query;
  
  // Set up Server-Sent Events for real-time updates
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no' // Disable nginx buffering for real-time streaming
  });

  const args = ['jest'];
  if (testFile && testFile !== '') {
    args.push(testFile as string);
  }
  if (coverage === 'true') {
    args.push('--coverage');
  }
  args.push('--verbose', '--json');

  const jestProcess = spawn('npx', args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' }
  });

  let outputBuffer = '';

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('start', { message: 'Test execution started', timestamp: new Date().toISOString() });

  jestProcess.stdout?.on('data', (data) => {
    const output = data.toString();
    outputBuffer += output;
    
    const cleanOutput = output.trim();
    
    // Filter out verbose coverage and compilation errors, focus on test progress
    if (cleanOutput && 
        !cleanOutput.includes('-------------------|---------|----------|---------|---------|-------------------') &&
        !cleanOutput.includes('File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s') &&
        !cleanOutput.includes('All files          |') &&
        !cleanOutput.includes(' .../components/') &&
        !cleanOutput.includes('|       0 |      100 |     100 |       0 |') &&
        !cleanOutput.includes('|       0 |        0 |       0 |       0 |') &&
        !cleanOutput.includes('Uncovered Line #s') &&
        cleanOutput.length > 5) {
      
      // Send clean test output
      sendEvent('output', { output: cleanOutput });
    }
  });

  jestProcess.stderr?.on('data', (data) => {
    const output = data.toString();
    const cleanError = output.trim();
    
    // Filter out known babel/syntax errors that don't affect test results
    if (cleanError && 
        !cleanError.includes('BABEL_SHOW_CONFIG_FOR') &&
        !cleanError.includes('@babel/preset-react') &&
        !cleanError.includes('babel-plugin-syntax-jsx') &&
        !cleanError.includes('SyntaxError: Support for the experimental') &&
        !cleanError.includes('Add @babel/preset-react') &&
        !cleanError.includes('npx cross-env BABEL_SHOW_CONFIG_FOR') &&
        !cleanError.includes('at constructor (/home/runner/workspace/node_modules/@babel') &&
        !cleanError.includes('at Parser.') &&
        !cleanError.includes('/node_modules/@babel') &&
        !cleanError.includes('STACK:') &&
        !cleanError.includes('Failed to collect coverage from') &&
        !cleanError.includes('ERROR: client/src/components') &&
        !cleanError.includes('error TS2339:') &&
        !cleanError.includes('                           ~~~~~~~~~~~~~~~~~') &&
        cleanError.length > 10) {
      
      // Only send actual errors, not babel configuration noise
      sendEvent('error', { output: cleanError });
    }
  });

  jestProcess.on('close', (code) => {
    try {
      // Try to parse JSON output from Jest
      const lines = outputBuffer.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('testResults'));
      
      if (jsonLine) {
        const testResults = JSON.parse(jsonLine);
        sendEvent('complete', {
          success: code === 0,
          code,
          results: testResults,
          timestamp: new Date().toISOString()
        });
      } else {
        sendEvent('complete', {
          success: code === 0,
          code,
          message: code === 0 ? 'Tests completed successfully' : 'Tests failed',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      sendEvent('complete', {
        success: false,
        code,
        error: 'Failed to parse test results',
        timestamp: new Date().toISOString()
      });
    }
    
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    if (jestProcess && !jestProcess.killed) {
      jestProcess.kill('SIGTERM');
    }
  });
  
  req.on('error', () => {
    if (jestProcess && !jestProcess.killed) {
      jestProcess.kill('SIGTERM');
    }
  });
});

// Get test coverage summary
router.get('/coverage-summary', requireRole(['super_admin']), async (req, res) => {
  try {
    const coverageFile = 'coverage/coverage-summary.json';
    try {
      const coverage = await fs.readFile(coverageFile, 'utf-8');
      const coverageData = JSON.parse(coverage);
      
      // Log for debugging
      console.log('Coverage data loaded successfully:', Object.keys(coverageData));
      res.json(coverageData);
    } catch (error) {
      console.log('Coverage file not found, trying to find alternative coverage files...');
      
      // Try to find any coverage files
      try {
        const { readdir } = require('fs/promises');
        const files = await readdir('coverage');
        console.log('Available coverage files:', files);
        res.json({ message: 'No coverage-summary.json found. Available files: ' + files.join(', ') });
      } catch (dirError) {
        res.json({ message: 'No coverage data available. Run tests with --coverage flag first.' });
      }
    }
  } catch (error) {
    console.error('Error reading coverage:', error);
    res.status(500).json({ error: 'Failed to read coverage data' });
  }
});

export default router;