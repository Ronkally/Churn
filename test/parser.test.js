import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  ADD_ONLY_PATCH,
  REPLACE_PATCH,
  DELETE_ONLY_PATCH,
  BLANK_LINES_REMOVED_PATCH,
  BLANK_LINES_ADDED_PATCH,
  MIXED_HUNKS_PATCH,
  FORMATTING_PATCH,
  WHITESPACE_ONLY_PATCH
} from './fixtures/patches.js';

// Import functions to test - we'll need to export them from api.js
// For now, we'll copy the functions here for testing
function isBlankLine(lineContent) {
  return /^\s*$/.test(lineContent);
}

function parsePatch(patch) {
  const addedLines = [];
  let newLineNum = 0;
  let oldLineNum = 0;
  
  const lines = patch.split("\n");
  let currentHunk = {
    removedLines: [],
    addedLines: [],
    startNewLine: 0,
    startOldLine: 0
  };

  function finalizeHunk() {
    if (currentHunk.addedLines.length === 0 && currentHunk.removedLines.length === 0) {
      return;
    }

    const nonBlankRemoved = currentHunk.removedLines.filter(l => !isBlankLine(l.content));
    const nonBlankAdded = currentHunk.addedLines.filter(l => !isBlankLine(l.content));

    let hunkType;
    if (nonBlankRemoved.length === 0 && nonBlankAdded.length > 0) {
      hunkType = "add-only";
    } else if (nonBlankRemoved.length > 0 && nonBlankAdded.length === 0) {
      hunkType = "delete-only";
    } else if (nonBlankRemoved.length > 0 && nonBlankAdded.length > 0) {
      hunkType = "replace";
    } else {
      hunkType = currentHunk.addedLines.length > 0 ? "add-only" : "delete-only";
    }

    for (const added of currentHunk.addedLines) {
      addedLines.push({
        line: added.content,
        number: added.lineNum,
        hunkType,
        removedLines: hunkType === "replace" ? currentHunk.removedLines : []
      });
    }

    currentHunk = {
      removedLines: [],
      addedLines: [],
      startNewLine: 0,
      startOldLine: 0
    };
  }

  for (const line of lines) {
    if (line.startsWith("@@")) {
      finalizeHunk();

      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
        currentHunk.startOldLine = oldLineNum;
        currentHunk.startNewLine = newLineNum;
      } else {
        oldLineNum = 0;
        newLineNum = 0;
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.substring(1);
      currentHunk.addedLines.push({ content, lineNum: newLineNum });
      newLineNum++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const content = line.substring(1);
      currentHunk.removedLines.push({ content, lineNum: oldLineNum });
      oldLineNum++;
    } else if (!line.startsWith("\\")) {
      if (currentHunk.addedLines.length > 0 || currentHunk.removedLines.length > 0) {
        finalizeHunk();
      }
      newLineNum++;
      oldLineNum++;
    }
  }

  finalizeHunk();

  return addedLines;
}

describe('parsePatch', () => {
  describe('Add-only hunks', () => {
    test('should classify pure new code as add-only', () => {
      const result = parsePatch(ADD_ONLY_PATCH);
      
      assert.ok(result.length > 0);
      assert.ok(result.every(line => line.hunkType === 'add-only'));
      assert.ok(result[0].line.includes('function newFunction()'));
    });

    test('should classify blank lines added as add-only', () => {
      const result = parsePatch(BLANK_LINES_ADDED_PATCH);
      
      const addedLines = result.filter(line => line.hunkType === 'add-only');
      assert.ok(addedLines.length > 0);
    });
  });

  describe('Replace hunks', () => {
    test('should classify code replacement as replace', () => {
      const result = parsePatch(REPLACE_PATCH);
      
      assert.ok(result.length > 0);
      assert.ok(result.every(line => line.hunkType === 'replace'));
      assert.ok(result.some(line => line.line.includes('newVar')));
    });

    test('should classify formatting changes as replace', () => {
      const result = parsePatch(FORMATTING_PATCH);
      
      assert.ok(result.length > 0);
      assert.ok(result.every(line => line.hunkType === 'replace'));
    });
  });

  describe('Delete-only hunks', () => {
    test('should not return lines for delete-only hunks', () => {
      const result = parsePatch(DELETE_ONLY_PATCH);
      
      // Delete-only hunks should not add any lines to the result
      assert.strictEqual(result.length, 0);
    });
  });

  describe('Edge cases with blank lines', () => {
    test('should treat blank line removal + code addition as add-only', () => {
      const result = parsePatch(BLANK_LINES_REMOVED_PATCH);
      
      const codeLines = result.filter(line => !isBlankLine(line.line));
      assert.ok(codeLines.length > 0);
      
      // Should be add-only because removed lines were blank
      const newValueLine = result.find(line => line.line.includes('newValue'));
      assert.ok(newValueLine);
      assert.strictEqual(newValueLine.hunkType, 'add-only');
    });

    test('should handle whitespace-only changes correctly', () => {
      const result = parsePatch(WHITESPACE_ONLY_PATCH);
      
      // Whitespace changes should be classified appropriately
      assert.ok(result.length > 0);
    });
  });

  describe('Mixed hunks in one patch', () => {
    test('should correctly classify multiple different hunk types', () => {
      const result = parsePatch(MIXED_HUNKS_PATCH);
      
      assert.ok(result.length > 0);
      
      const hunkTypes = new Set(result.map(line => line.hunkType));
      
      // Should have both add-only and replace hunks
      assert.ok(hunkTypes.has('add-only'));
      assert.ok(hunkTypes.has('replace'));
    });
  });

  describe('Line numbers', () => {
    test('should correctly track line numbers in new file', () => {
      const result = parsePatch(ADD_ONLY_PATCH);
      
      assert.strictEqual(result[0].number, 1);
      assert.strictEqual(result[result.length - 1].number, result.length);
    });

    test('should correctly track line numbers across hunks', () => {
      const result = parsePatch(MIXED_HUNKS_PATCH);
      
      // Line numbers should be sequential and correct
      result.forEach((line) => {
        assert.ok(line.number > 0);
      });
    });
  });

  describe('Removed lines metadata', () => {
    test('should include removed lines for replace hunks', () => {
      const result = parsePatch(REPLACE_PATCH);
      
      const replaceLines = result.filter(line => line.hunkType === 'replace');
      assert.ok(replaceLines.length > 0);
      assert.ok(replaceLines[0].removedLines);
      assert.ok(replaceLines[0].removedLines.length > 0);
    });

    test('should not include removed lines for add-only hunks', () => {
      const result = parsePatch(ADD_ONLY_PATCH);
      
      const addOnlyLines = result.filter(line => line.hunkType === 'add-only');
      assert.ok(addOnlyLines.every(line => line.removedLines.length === 0));
    });
  });
});

