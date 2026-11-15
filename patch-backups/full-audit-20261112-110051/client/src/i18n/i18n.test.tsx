import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { en } from './en';
import { ur } from './ur';
import { translate, useLang } from './index';
import { LangSwitch } from '../components/Layout';
import { act } from 'react';

describe('i18n', () => {
  it('Urdu dictionary covers every English key', () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
  });
  it('interpolates variables', () => {
    expect(translate('en', 'submittedOf', { done: 3, total: 5 })).toBe('3 of 5 classrooms submitted');
    expect(translate('ur', 'pendingSync', { n: 2 })).toContain('2');
  });
  it('switching to Urdu sets dir=rtl and lang=ur on <html>', () => {
    render(<MemoryRouter><LangSwitch /></MemoryRouter>);
    act(() => useLang.getState().setLang('ur'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ur');
    act(() => useLang.getState().setLang('en'));
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  });
});
