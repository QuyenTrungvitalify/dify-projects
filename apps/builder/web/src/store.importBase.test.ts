/**
 * Spec 051 S2 — store.importBase (D5). `./api` is mocked (importBase + tree) while ApiError stays the
 * real class so `instanceof` in importBase holds. Asserts: success refreshes the tree and returns
 * `{ project, workflow, slugNote? }`; a 400 (linter reject / limits) returns the verbatim `{ error }`
 * WITHOUT touching the tree.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ApiError } from './api';

const { importBaseMock, treeMock } = vi.hoisted(() => ({
  importBaseMock: vi.fn(),
  treeMock: vi.fn(async () => ({ projects: [] })),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return {
    ...actual,
    api: { ...actual.api, importBase: importBaseMock, tree: treeMock },
  };
});

import { importBase } from './store';

beforeEach(() => {
  importBaseMock.mockReset();
  treeMock.mockClear();
  treeMock.mockResolvedValue({ projects: [] });
});

describe('importBase — success (D5)', () => {
  test('returns { project, workflow } and refreshes the tree first', async () => {
    importBaseMock.mockResolvedValue({ project: '_drafts', workflow: 'chatwork' });
    const r = await importBase({ yaml: 'app:\n  name: x\n' });
    expect(r).toEqual({ project: '_drafts', workflow: 'chatwork' });
    expect(treeMock).toHaveBeenCalledOnce(); // the new base is visible before auto-select
  });

  test('carries a slugNote when the server auto-suffixed a collision', async () => {
    importBaseMock.mockResolvedValue({ project: '_drafts', workflow: 'chatwork_2', slugNote: "'chatwork' already exists" });
    const r = await importBase({ yaml: 'app:\n  name: x\n' });
    expect(r).toEqual({ project: '_drafts', workflow: 'chatwork_2', slugNote: "'chatwork' already exists" });
  });
});

describe('importBase — failure returns the verbatim message, no tree refresh', () => {
  test('400 (linter reject) → { error }, tree NOT refreshed', async () => {
    importBaseMock.mockRejectedValue(new ApiError(400, 'validate_workflow.py exit 1: root is not a mapping'));
    const r = await importBase({ yaml: 'not a workflow' });
    expect(r).toEqual({ error: 'validate_workflow.py exit 1: root is not a mapping' });
    expect(treeMock).not.toHaveBeenCalled();
  });

  test('non-ApiError → stringified', async () => {
    importBaseMock.mockRejectedValue(new Error('network down'));
    const r = await importBase({ yaml: 'app:\n' });
    expect(r).toEqual({ error: 'Error: network down' });
  });
});
