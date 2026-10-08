import Link from 'next/link';

const scenarios = [
  { number: '01', title: 'A fallen tree.', image: '/demo/tree.jpg', alt: 'Recorded Pudle camera view with a fallen tree photo on a laptop', description: 'A camera observation becomes a possible road-blockage report after the driver confirms it.' },
  { number: '02', title: 'An animal by the road.', image: '/demo/receiver.jpg', alt: 'The second iPhone showing a received convoy hazard report', description: 'The other phone receives the shared report as a visible alert and a spoken heads-up.' },
  { number: '03', title: 'A pothole.', image: '/demo/pothole.jpg', alt: 'Recorded Pudle view of a pothole photo and the confirmation controls', description: 'The same flow works for another kind of obstacle: spot it, confirm it, share it.' },
];

export default function Home() {
  return <main className="landing demo-landing">
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Pudle home"><span className="brand-mark">p.</span> pudle</Link>
      <nav className="demo-nav" aria-label="Main navigation"><a href="#demo">Watch the demo</a><Link href="/app" className="header-link">Open web app ↗</Link></nav>
    </header>
    <section className="demo-hero">
      <div><p className="eyebrow">YOUR ROAD COMPANION</p><h1>One driver sees it.<br/><em>The next gets<br/>a heads-up.</em></h1>
        <p className="demo-lede">Pudle turns a camera observation into a driver-confirmed report, then shares it with the people in your convoy.</p>
        <div className="demo-actions"><a className="primary-link" href="#demo">See Pudle in action <span aria-hidden="true">↓</span></a><a className="demo-secondary" href="#walkthrough">Explore the walkthrough ↗</a></div>
        <div className="demo-pills"><span>Camera + voice</span><span>Private convoys</span><span>iPhone prototype</span></div>
      </div>
      <div className="demo-hero-visual"><span className="visual-caption">FROM THE ACTUAL RECORDING</span><img src="/demo/tree.jpg" alt="Pudle running on an iPhone in front of the fallen-tree test photo" width="540" height="960" fetchPriority="high"/><div className="visual-note"><span aria-hidden="true">◖))</span><div><strong>See. Confirm. Share.</strong><span>A little heads-up for the road ahead.</span></div></div></div>
    </section>
    <section id="demo" className="demo-watch">
      <div className="demo-watch-copy"><p className="eyebrow">WATCH THE WORKING PROTOTYPE</p><h2>Three scenarios.<br/>Two phones.<br/><em>One shared heads-up.</em></h2><p>Watch the camera observation, the driver’s confirmation, and the report arriving on the other iPhone.</p><ol className="demo-video-steps"><li><span>01</span>Fallen tree / possible blockage</li><li><span>02</span>Animal beside the road</li><li><span>03</span>Pothole</li></ol><p className="demo-context">Recorded using hazard photos displayed on a computer, with demo delivery enabled. Response waits are shortened in the edit.</p><a href="https://www.youtube.com/shorts/8gv9OXGDTJA" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a></div>
      <div className="demo-video"><iframe src="https://www.youtube-nocookie.com/embed/8gv9OXGDTJA?rel=0&playsinline=1" title="Pudle demo: three hazard scenarios and two-phone convoy alerts" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen loading="lazy"/></div>
    </section>
    <section id="walkthrough" className="demo-walkthrough"><div className="demo-section-heading"><p className="eyebrow">THE DEMO, SLIDE BY SLIDE</p><h2>Small observations.<br/>Shared awareness.</h2><p>Swipe through the three examples, or watch the complete flow above.</p></div>
      <div className="demo-slides" tabIndex={0} aria-label="Three demo scenario slides">{scenarios.map(scene=><article className="demo-slide" key={scene.number}><div className="demo-slide-copy"><span className="eyebrow">SCENARIO {scene.number} / 03</span><h3>{scene.title}</h3><p>{scene.description}</p><span className="demo-slide-tag">Frame from the recorded demo</span></div><img src={scene.image} alt={scene.alt} width="540" height="960" loading="lazy"/></article>)}</div>
    </section>
    <section className="demo-flow"><p className="eyebrow">HOW IT COMES TOGETHER</p><h2>A voice-first flow.</h2><div className="demo-flow-grid">{[['01','See it','The foreground camera sends a frame for a possible-hazard observation.'],['02','Confirm it','Say “report it” or tap to confirm before the observation is shared.'],['03','Share it','The report travels through the backend to your private convoy.'],['04','Get a heads-up','The receiving phone shows the hazard and can read the report aloud.']].map(([n,title,copy])=><article key={n}><span>{n}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="demo-close"><p className="eyebrow">BUILT TO KEEP GETTING BETTER</p><h2>Your road companion.<br/>A little more aware.</h2><p>The native iPhone prototype brings camera observations, voice confirmation, and convoy alerts together. Explore the web convoy app, or see how it is built.</p><div className="demo-actions"><Link href="/app" className="primary-link">Open the web app ↗</Link><a className="demo-secondary" href="https://github.com/darssan-eswar/pudle">Explore the source ↗</a></div><details className="demo-details"><summary>About this prototype</summary><p>The recording demonstrates photo-based detection and convoy delivery. Demo mode skips GPS and direction filtering. Normal mode uses location relevance checks. The iPhone camera requires Pudle on screen; background notifications depend on device permissions and the active driving session. This is a prototype, not a validated driving safety system.</p></details></section>
    <footer className="site-footer"><span className="brand">pudle</span><span>Road context shared with the people on your trip.</span><a href="#demo">Watch the demo ↑</a></footer>
  </main>;
}
