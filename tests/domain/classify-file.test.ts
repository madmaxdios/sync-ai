import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/domain/classify-file';
import { FileState } from '../../src/domain/file-state';

const buf = (text: string): Buffer => Buffer.from(text);

describe('classifyFile', () => {
  describe('both sides have the file', () => {
    it('is in sync when the contents match, whatever the base says', () => {
      expect(classifyFile({ local: buf('a\n'), repo: buf('a\n'), base: buf('old\n') })).toBe(
        FileState.InSync,
      );
      expect(classifyFile({ local: buf('a\n'), repo: buf('a\n'), base: undefined })).toBe(
        FileState.InSync,
      );
    });

    it('ignores CRLF vs LF when comparing', () => {
      expect(classifyFile({ local: buf('a\r\n'), repo: buf('a\n'), base: undefined })).toBe(
        FileState.InSync,
      );
    });

    it('is repo-changed when only the repository moved away from the base', () => {
      expect(classifyFile({ local: buf('v1\n'), repo: buf('v2\n'), base: buf('v1\n') })).toBe(
        FileState.RepoChanged,
      );
    });

    it('is local-changed when only the local copy moved away from the base', () => {
      expect(classifyFile({ local: buf('v2\n'), repo: buf('v1\n'), base: buf('v1\n') })).toBe(
        FileState.LocalChanged,
      );
    });

    it('is a conflict when both sides changed differently', () => {
      expect(classifyFile({ local: buf('L\n'), repo: buf('R\n'), base: buf('v1\n') })).toBe(
        FileState.Conflict,
      );
    });

    it('is a conflict when the files differ and there is no base (first device)', () => {
      expect(classifyFile({ local: buf('L\n'), repo: buf('R\n'), base: undefined })).toBe(
        FileState.Conflict,
      );
    });
  });

  describe('only the local copy exists', () => {
    it('is new-local without a base', () => {
      expect(classifyFile({ local: buf('a\n'), repo: undefined, base: undefined })).toBe(
        FileState.NewLocal,
      );
    });

    it('is repo-deleted when the local copy still equals the base', () => {
      expect(classifyFile({ local: buf('a\n'), repo: undefined, base: buf('a\n') })).toBe(
        FileState.RepoDeleted,
      );
    });

    it('is a conflict when it was modified locally and deleted in the repository', () => {
      expect(classifyFile({ local: buf('edit\n'), repo: undefined, base: buf('a\n') })).toBe(
        FileState.Conflict,
      );
    });
  });

  describe('only the repository copy exists', () => {
    it('is new-repo without a base', () => {
      expect(classifyFile({ local: undefined, repo: buf('a\n'), base: undefined })).toBe(
        FileState.NewRepo,
      );
    });

    it('is local-deleted when the repository still equals the base', () => {
      expect(classifyFile({ local: undefined, repo: buf('a\n'), base: buf('a\n') })).toBe(
        FileState.LocalDeleted,
      );
    });

    it('is a conflict when it was deleted locally and modified in the repository', () => {
      expect(classifyFile({ local: undefined, repo: buf('new\n'), base: buf('a\n') })).toBe(
        FileState.Conflict,
      );
    });
  });

  it('is gone when neither side has the file', () => {
    expect(classifyFile({ local: undefined, repo: undefined, base: buf('a\n') })).toBe(
      FileState.Gone,
    );
  });
});
