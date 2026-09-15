import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProductApp from './app/page';
import LandingPage from './page';

describe('public and product routes', () => {
  it('keeps the public landing page focused on the real product route', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('A clearer view');
    expect(html).toContain('href="/app"');
    expect(html).toContain('href="#how-it-works"');
    expect(html).toContain('https://github.com/darssan-eswar/pudle');
    expect(html).not.toContain('Sign in to Pudle');
  });

  it('keeps session restoration inside the product route', () => {
    const html = renderToStaticMarkup(<ProductApp />);

    expect(html).toContain('Restoring your private session');
    expect(html).not.toContain('A clearer view');
  });
});
