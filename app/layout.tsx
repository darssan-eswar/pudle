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
  metadataBase: new URL('https://pudle-road-intelligence.ledarssan919276.chatgpt.site'),
  title: 'Pudle — Peer Updated Driving Logic Engine',
  description: 'Privacy-first road alerts with local capture and optional disclosed cloud analysis.',
  applicationName: 'Pudle',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pudle',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Pudle — Peer Updated Driving Logic Engine',
    description: 'Turn any phone into a privacy-first road-intelligence node.',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'Pudle privacy-first road intelligence network' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pudle — Peer Updated Driving Logic Engine',
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
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#fbf7ef" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
