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

// Data Sync Management Routes

// Get lookup data comparison between environments
router.get('/data-sync/compare/:env1/:env2', requireRole(['super_admin']), async (req, res) => {
  try {
    const { env1, env2 } = req.params;
    
    const scriptPath = path.join(process.cwd(), 'scripts', 'data-sync-manager.ts');
    const child = spawn('tsx', [scriptPath, 'compare', env1, env2], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Parse the comparison output
        const lines = stdout.split('\n');
        const comparisons = [];
        let currentTable = null;
        
        for (const line of lines) {
          if (line.includes('📋')) {
            const match = line.match(/📋 (.+):/);
            if (match) {
              currentTable = match[1];
            }
          } else if (line.includes('✅') && currentTable) {
            const match = line.match(/✅ (\d+) rows in both environments/);
            if (match) {
              comparisons.push({
                table: currentTable,
                status: 'identical',
                env1Count: parseInt(match[1]),
                env2Count: parseInt(match[1]),
                difference: 0
              });
            }
          } else if (line.includes('❌') && currentTable) {
            const match = line.match(/❌ .+: (\d+) rows \| .+: (\d+) rows \(diff: (\d+)\)/);
            if (match) {
              comparisons.push({
                table: currentTable,
                status: 'different',
                env1Count: parseInt(match[1]),
                env2Count: parseInt(match[2]),
                difference: parseInt(match[3])
              });
            }
          }
        }

        res.json({
          success: true,
          env1,
          env2,
          comparisons,
          totalTables: comparisons.length,
          identicalTables: comparisons.filter(c => c.status === 'identical').length
        });
      } else {
        res.status(500).json({
          success: false,
          error: stderr || 'Comparison failed',
          stdout
        });
      }
    });

  } catch (error) {
    console.error('Error in data sync comparison:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Export lookup data from environment
router.post('/data-sync/export/:env', requireRole(['super_admin']), async (req, res) => {
  try {
    const { env } = req.params;
    const { tables } = req.body; // Optional array of specific tables
    
    const scriptPath = path.join(process.cwd(), 'scripts', 'data-sync-manager.ts');
    const args = ['tsx', scriptPath, 'export', env];
    if (tables && tables.length > 0) {
      args.push(...tables);
    }

    const child = spawn(args[0], args.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Parse export results
        const exportMatch = stdout.match(/Export completed: (.+)\.json/);
        const tablesMatch = stdout.match(/Tables: (\d+)/);
        const rowsMatch = stdout.match(/Total rows: (\d+)/);
        
        res.json({
          success: true,
          exportName: exportMatch ? exportMatch[1] : null,
          tables: tablesMatch ? parseInt(tablesMatch[1]) : 0,
          totalRows: rowsMatch ? parseInt(rowsMatch[1]) : 0,
          sourceEnvironment: env,
          output: stdout
        });
      } else {
        res.status(500).json({
          success: false,
          error: stderr || 'Export failed',
          stdout
        });
      }
    });

  } catch (error) {
    console.error('Error in data sync export:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Import lookup data to environment
router.post('/data-sync/import/:env/:exportName', requireRole(['super_admin']), async (req, res) => {
  try {
    const { env, exportName } = req.params;
    const { dryRun, clearFirst, tables } = req.body;
    
    const scriptPath = path.join(process.cwd(), 'scripts', 'data-sync-manager.ts');
    const args = ['tsx', scriptPath, 'import', env, exportName];
    
    if (dryRun) args.push('--dry-run');
    if (clearFirst) args.push('--clear-first');
    if (tables && tables.length > 0) {
      args.push(...tables);
    }

    const child = spawn(args[0], args.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Parse import results
        const lines = stdout.split('\n');
        const importedTables = [];
        let totalRows = 0;
        
        for (const line of lines) {
          const match = line.match(/✅ (\d+) rows .* imported/);
          if (match) {
            totalRows += parseInt(match[1]);
          }
          
          const tableMatch = line.match(/📊 Importing (.+) \((\d+) rows\)/);
          if (tableMatch) {
            importedTables.push({
              table: tableMatch[1],
              rows: parseInt(tableMatch[2])
            });
          }
        }
        
        res.json({
          success: true,
          targetEnvironment: env,
          exportName,
          importedTables,
          totalRows,
          dryRun: !!dryRun,
          output: stdout
        });
      } else {
        res.status(500).json({
          success: false,
          error: stderr || 'Import failed',
          stdout
        });
      }
    });

  } catch (error) {
    console.error('Error in data sync import:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// List available exports
router.get('/data-sync/exports', requireRole(['super_admin']), async (req, res) => {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'data-sync-manager.ts');
    const child = spawn('tsx', [scriptPath, 'list'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('📁 Available exports:'));
        const exports = lines.map(line => line.trim()).filter(line => line.length > 0);
        
        res.json({
          success: true,
          exports
        });
      } else {
        res.status(500).json({
          success: false,
          error: stderr || 'Failed to list exports',
          stdout
        });
      }
    });

  } catch (error) {
    console.error('Error listing exports:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get export information
router.get('/data-sync/exports/:exportName', requireRole(['super_admin']), async (req, res) => {
  try {
    const { exportName } = req.params;
    
    const scriptPath = path.join(process.cwd(), 'scripts', 'data-sync-manager.ts');
    const child = spawn('tsx', [scriptPath, 'info', exportName], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Parse export info
        const lines = stdout.split('\n');
        const sourceMatch = stdout.match(/🔗 Source: (.+)/);
        const createdMatch = stdout.match(/📅 Created: (.+)/);
        const tablesMatch = stdout.match(/📊 Tables: (\d+)/);
        const rowsMatch = stdout.match(/📝 Total rows: (\d+)/);
        
        const tableDetails = [];
        for (const line of lines) {
          const match = line.match(/✅ (.+): (\d+) rows \((.+)\.\.\.\)/);
          if (match) {
            tableDetails.push({
              table: match[1],
              rows: parseInt(match[2]),
              checksum: match[3]
            });
          }
        }
        
        res.json({
          success: true,
          exportName,
          sourceEnvironment: sourceMatch ? sourceMatch[1] : null,
          createdAt: createdMatch ? createdMatch[1] : null,
          totalTables: tablesMatch ? parseInt(tablesMatch[1]) : 0,
          totalRows: rowsMatch ? parseInt(rowsMatch[1]) : 0,
          tableDetails
        });
      } else {
        res.status(500).json({
          success: false,
          error: stderr || 'Failed to get export info',
          stdout
        });
      }
    });

  } catch (error) {
    console.error('Error getting export info:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;