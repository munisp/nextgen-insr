#!/usr/bin/env node

/**
 * Automated Console.log Replacer
 * 
 * Scans TypeScript files and replaces console.log/warn/error
 * with the production logger (server/_core/logger.ts)
 * 
 * Usage: node scripts/fix-console-logs.cjs [--fix]
 */

const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '..', 'server');
const EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = ['node_modules', '.git', '__pycache__', 'dist', 'build', '.next', 'tests'];

/**
 * Recursively get all TypeScript files
 */
function getTsFiles(dir) {
  const files = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) {
          files.push(...getTsFiles(fullPath));
        }
      } else if (entry.isFile() && EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Silently skip
  }
  
  return files;
}

/**
 * Replace console.log with logger
 */
function replaceConsoleCalls(content, filePath) {
  let newContent = content;
  let replacements = 0;
  
  // Add logger import if not present
  if (!newContent.includes("from '../_core/logger")) {
    const importStatement = "import { logger } from '../_core/logger.js';\n";
    if (newContent.includes('import ')) {
      newContent = newContent.replace(/(import .+;)/, `$1\n${importStatement}`);
    } else {
      newContent = importStatement + newContent;
    }
  }
  
  // Replace console.log
  const logPattern = /console\.log\((.+?)\)/g;
  let match;
  while ((match = logPattern.exec(newContent)) !== null) {
    newContent = newContent.replace(match[0], `logger.info(${match[1]})`);
    replacements++;
  }
  
  // Replace console.warn
  const warnPattern = /console\.warn\((.+?)\)/g;
  while ((match = warnPattern.exec(newContent)) !== null) {
    newContent = newContent.replace(match[0], `logger.warn(${match[1]})`);
    replacements++;
  }
  
  // Replace console.error
  const errorPattern = /console\.error\((.+?)\)/g;
  while ((match = errorPattern.exec(newContent)) !== null) {
    newContent = newContent.replace(match[0], `logger.error(${match[1]})`);
    replacements++;
  }
  
  return { newContent, replacements };
}

/**
 * Generate report
 */
function generateReport(files, fixedCount) {
  let totalReplacements = 0;
  const filesWithConsole = [];
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const logCount = (content.match(/console\.(log|warn|error)/g) || []).length;
    
    if (logCount > 0) {
      totalReplacements += logCount;
      filesWithConsole.push({
        file: path.relative(path.join(__dirname, '..'), file),
        count: logCount,
      });
    }
  }
  
  let report = `
╔═══════════════════════════════════════════════════════════╗
║          Console.log Replacement Analysis Report          ║
╚═══════════════════════════════════════════════════════════╝

📊 Summary:
  • Total files analyzed: ${files.length}
  • Files with console.* calls: ${filesWithConsole.length}
  • Total console.* calls found: ${totalReplacements}
  • Files fixed: ${fixedCount}

🔴 Production Logging Issues:
  • console.log statements should use structured logger
  • Console output bypasses logging infrastructure
  • Missing correlation IDs and structured data

💡 Recommendations:
  1. Use logger.info() for informational messages
  2. Use logger.warn() for warnings
  3. Use logger.error() for errors
  4. Include context data in structured format
`;
  
  if (filesWithConsole.length > 0) {
    report += `\n📝 Files with console.log (top 10):\n${filesWithConsole
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(f => `  • ${f.file}: ${f.count} calls`)
      .join('\n')}`;
  }
  
  return report;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');
  
  console.log('🔍 Analyzing TypeScript files for console.log usage...\n');
  
  const files = getTsFiles(TARGET_DIR);
  console.log('📁 Found ' + files.length + ' TypeScript files\n');
  
  // Analyze each file
  let fixedCount = 0;
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const logCount = (content.match(/console\.(log|warn|error)/g) || []).length;
    
    if (logCount > 0) {
      const { newContent, replacements } = replaceConsoleCalls(content, file);
      
      if (shouldFix) {
        fs.writeFileSync(file, newContent);
        console.log('✓ Fixed ' + path.relative(path.join(__dirname, '..'), file) + ' (' + replacements + ' replacements)');
        fixedCount++;
      }
    }
  }
  
  // Generate report
  const report = generateReport(files, fixedCount);
  console.log('\n' + report);
  
  // Save report
  const reportPath = path.join(__dirname, '..', 'CONSOLE_LOG_REPORT.md');
  fs.writeFileSync(reportPath, 'Console Log Analysis Report\n\n' + report);
  console.log('\n📄 Report saved to: ' + reportPath);
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
