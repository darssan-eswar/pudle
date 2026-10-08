import Link from 'next/link';

const chapters = [
  {
    number: '01',
    title: 'The road changes first.',
    copy: 'Conditions shift before drivers hear about them. Useful observations stay on individual phones. Checking several screens takes attention.',
  },
  {
    number: '02',
    title: 'Keep the useful parts close.',
    copy: 'Record locally. Share one confirmed nearby observation. Ask Pudy what Pudle currently displays.',
  },
  {
    number: '03',
    title: 'Cloud only when you choose it.',
    copy: 'Optional analysis sends periodic compressed still frames only after separate consent. Full recordings and recording audio stay in your browser.',
  },
  {
    number: '04',
    title: 'Say “Hey Pudy.”',
    copy: 'After you enable foreground voice, Pudy can listen for the wake phrase while the page is visible. Browser speech services may process microphone audio; text always remains available.',
  },
] as const;

export default function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-wordmark" href="/" aria-label="Pudle home">
          <span aria-hidden="true">p</span>
          Pudle
        </Link>
        <Link className="landing-nav__cta" href="/app">Open Pudle</Link>
      </nav>

      <section className="landing-hero" aria-labelledby="landing-title">
        <p className="landing-kicker">Private dashcam · Voice companion</p>
        <h1 id="landing-title">A clearer view<br />of the road.</h1>
        <p className="landing-definition">
          Pudle turns your phone into a private dashcam with a voice companion.
        </p>
        <div className="landing-actions">
          <Link className="landing-button landing-button--primary" href="/app">
            Open Pudle <span aria-hidden="true">↗</span>
          </Link>
          <a className="landing-button landing-button--secondary" href="#how-it-works">
            How it works <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="landing-hero__note">
          <span>Local recording</span>
          <span>Confirmed reports</span>
          <span>Foreground voice</span>
        </div>
      </section>

      <section className="landing-chapters" id="how-it-works" aria-label="How Pudle works">
        {chapters.map((chapter, index) => (
          <article className="landing-chapter" key={chapter.number}>
            <p className="landing-chapter__number">{chapter.number}</p>
            <div>
              <h2>{chapter.title}</h2>
              <p>{chapter.copy}</p>
            </div>
            <p className="landing-chapter__aside" aria-hidden="true">
              {index === 0 ? 'Observe' : index === 1 ? 'Confirm' : index === 2 ? 'Consent' : 'Ask'}
            </p>
          </article>
        ))}
      </section>

      <section className="landing-close" aria-labelledby="landing-close-title">
        <p className="landing-kicker">Pudle + Pudy</p>
        <h2 id="landing-close-title">Your phone.<br />Your road context.</h2>
        <p>Start with the camera. Keep recording local. Share only what you confirm.</p>
        <Link className="landing-button landing-button--primary" href="/app">
          Open Pudle <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className="landing-footer">
        <Link className="landing-wordmark" href="/" aria-label="Pudle home">
          <span aria-hidden="true">p</span>
          Pudle
        </Link>
        <p>Private road context, designed for a phone.</p>
        <a href="https://github.com/darssan-eswar/pudle">GitHub</a>
      </footer>
    </main>
  );
}
