import Link from 'next/link';

export default function Home() {
  return (
    <main className="landing">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Pudle home"><span className="brand-mark">p.</span> pudle</Link>
        <Link href="/app" className="header-link">Open the app <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">THE TWO CAR DEMO</p>
          <h1>What one driver sees,<br/><em>the next one hears.</em></h1>
          <p className="hero-lede">A tree in the road should not be a surprise to the car behind. Pudle lets a convoy member report an obstacle and gives the following phone a spoken heads up.</p>
          <Link href="/app" className="primary-link">Start a convoy <span aria-hidden="true">↗</span></Link>
          <p className="hero-footnote">Two accounts · One private convoy · Reports expire after two minutes</p>
        </div>
        <div className="road-diagram" role="img" aria-label="Two cars on a road. The first reports a tree; the second receives a spoken report.">
          <div className="diagram-top"><span>01 / AHEAD</span><span>02 / FOLLOWING</span></div>
          <div className="road-lane"><span className="road-tree">✳</span><span className="road-car road-car--lead">p</span><span className="road-dash"/><span className="road-car road-car--follow">p</span></div>
          <div className="diagram-message"><span className="sound-icon">◖))</span><span>“Tree or branch in road reported.”</span></div>
        </div>
      </section>

      <section className="landing-steps" id="how-it-works">
        <div className="section-heading"><p className="eyebrow">ONE SITUATION, ONE JOB</p><h2>A heads up before you reach it.</h2></div>
        <div className="steps-grid">
          <article><span>01</span><h3>Make a convoy.</h3><p>Each person signs in. Share a private twelve character code with the second phone.</p></article>
          <article><span>02</span><h3>Report the obstacle.</h3><p>A passenger in the lead vehicle confirms the tree report with a tap.</p></article>
          <article><span>03</span><h3>Hear it behind.</h3><p>The following phone shows the report and reads it aloud when audio is enabled.</p></article>
        </div>
      </section>
      <footer className="site-footer"><span className="brand">pudle</span><span>Road context shared with the people on your trip.</span><a href="https://github.com/darssan-eswar/pudle">Source</a></footer>
    </main>
  );
}
