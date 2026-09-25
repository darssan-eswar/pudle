import type { Metadata, Viewport } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Pudle · road reports for your convoy',
  description: 'A small, private road obstacle demo for drivers traveling together.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f4ef' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
