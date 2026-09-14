import type { Metadata } from 'next';
import { env } from 'cloudflare:workers';
import { Geist, Geist_Mono } from 'next/font/google';
import { publicOrigin } from '@/server/public-origin';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export function generateMetadata(): Metadata {
  return {
  metadataBase: publicOrigin(env.APP_ORIGIN),
  title: 'Pudle — A clearer view of the road',
  description: 'A private dashcam with Pudy, your voice companion. Record locally, share confirmed road reports, and keep in touch with your ride.',
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
    title: 'Pudle — A clearer view of the road',
    description: 'A private dashcam with a voice companion. Record locally and share confirmed road reports.',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'Pudle privacy-first road intelligence network' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pudle — A clearer view of the road',
    description: 'A private dashcam with a voice companion. Record locally and share confirmed road reports.',
    images: ['/og.png'],
  },
  };
}

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
