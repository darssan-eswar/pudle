import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://pulzar-road-intelligence.ledarssan919276.chatgpt.site'),
  title: 'Pulzar — Road Intelligence',
  description: 'Privacy-first, real-time road intelligence powered by drivers already on the road.',
  openGraph: {
    title: 'Pulzar — Road Intelligence',
    description: 'Turn any phone into a privacy-first road-intelligence node.',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'Pulzar privacy-first road intelligence network' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pulzar — Road Intelligence',
    description: 'Turn any phone into a privacy-first road-intelligence node.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
