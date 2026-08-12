/**
 * Spec 031 S2 — store.createProject (D5) + mapCreateError (D3/D4).
 * `./api` is mocked (createProject + tree) while ApiError stays the real class so `instanceof` in
 * mapCreateError holds. Asserts: success sets targetProject + clears workflow/seed; a 409 leaves
 * settings untouched and returns `existing`; a 400 returns a plain error (no `existing`).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ApiError } from './api';

const { createProjectMock, treeMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  treeMock: vi.fn(async () => ({ projects: [] })),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return {
    ...actual,
    api: { ...actual.api, createProject: createProjectMock, tree: treeMock },
  };
});

import { createProject, mapCreateError, settings } from './store';

beforeEach(() => {
  createProjectMock.mockReset();
  treeMock.mockClear();
  treeMock.mockResolvedValue({ projects: [] });
  settings.value = { workflow: 'grammar', confirm: 'auto', seed: 's1', fast: true, targetProject: null, mode: 'build', chatLang: 'auto', model: 'opus' };
});

describe('createProject — success (D5)', () => {
  test('sets targetProject, clears workflow/seed, refreshes tree, returns { project }', async () => {
    createProjectMock.mockResolvedValue({ project: 'eiken_grammar', name: 'Eiken Grammar' });
    const r = await createProject('Eiken Grammar');
    expect(r).toEqual({ project: 'eiken_grammar' });
    expect(settings.value.targetProject).toBe('eiken_grammar');
    expect(settings.value.workflow).toBe('none');
    expect(settings.value.seed).toBe(null);
    // general prefs untouched (spec 036: deploy is no longer a setting)
    expect(settings.value.confirm).toBe('auto');
    expect(treeMock).toHaveBeenCalledOnce();
  });
});

describe('createProject — failures leave settings untouched', () => {
  test('409 → returns { error, existing }, settings unchanged', async () => {
    createProjectMock.mockRejectedValue(new ApiError(409, 'project exists', null, 'eiken_grammar'));
    const before = { ...settings.value };
    const r = await createProject('Eiken Grammar');
    expect(r).toEqual({ error: 'project exists', existing: 'eiken_grammar' });
    expect(settings.value).toEqual(before);
  });

  test('400 name_charset → returns { error } with no existing', async () => {
    createProjectMock.mockRejectedValue(new ApiError(400, 'name_charset'));
    const before = { ...settings.value };
    const r = await createProject('英検');
    expect(r).toEqual({ error: 'name_charset' });
    expect(settings.value).toEqual(before);
  });
});

describe('mapCreateError', () => {
  test('409 with existing → { error, existing }', () => {
    expect(mapCreateError(new ApiError(409, 'project exists', null, 'foo'))).toEqual({ error: 'project exists', existing: 'foo' });
  });
  test('409 without existing → { error } only', () => {
    expect(mapCreateError(new ApiError(409, 'busy'))).toEqual({ error: 'busy' });
  });
  test('non-ApiError → stringified', () => {
    expect(mapCreateError(new Error('boom'))).toEqual({ error: 'Error: boom' });
  });
});
