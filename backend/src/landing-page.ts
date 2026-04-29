const githubRepoUrl = "https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon";
const publicHomeUrl = "https://trustlens.z2hs.au";
const apkDownloadUrl = `${githubRepoUrl}/releases/latest/download/trustlens-debug.apk`;

export function landingPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TrustLens | Safer scrolling for real people</title>
    <meta
      name="description"
      content="TrustLens is an Android credibility companion that flags risky posts, links, and screenshots while you scroll."
    />
    <style>
      :root {
        --ink: #20283a;
        --ink-soft: #586174;
        --teal: #66b7b8;
        --teal-dark: #3b9fa1;
        --lavender: #aaa2e6;
        --gold: #d8a23e;
        --paper: #fbfaf7;
        --panel: #ffffff;
        --line: #e8e2da;
        --shadow: 0 24px 70px rgba(32, 40, 58, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at 18% 18%, rgba(102, 183, 184, 0.2), transparent 28%),
          radial-gradient(circle at 82% 4%, rgba(170, 162, 230, 0.18), transparent 24%),
          var(--paper);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        overflow-x: hidden;
      }

      a {
        color: inherit;
      }

      .page {
        min-height: 100vh;
        overflow: hidden;
      }

      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: min(1120px, calc(100% - 40px));
        margin: 0 auto;
        padding: 28px 0 18px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        color: var(--ink);
        font-size: 18px;
        font-weight: 720;
        text-decoration: none;
      }

      .mark {
        position: relative;
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: var(--panel);
        box-shadow: 0 12px 30px rgba(32, 40, 58, 0.12);
      }

      .mark::before,
      .mark::after {
        position: absolute;
        inset: 8px;
        content: "";
        border: 5px solid transparent;
        border-radius: 9px;
      }

      .mark::before {
        border-top-color: var(--teal);
        border-left-color: var(--teal);
        clip-path: polygon(0 0, 48% 0, 48% 34%, 34% 34%, 34% 48%, 0 48%);
      }

      .mark::after {
        border-right-color: var(--lavender);
        border-bottom-color: var(--ink);
        clip-path: polygon(52% 0, 100% 0, 100% 100%, 52% 100%, 52% 66%, 66% 66%, 66% 34%, 52% 34%);
      }

      .spark {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 12px;
        height: 12px;
        border-radius: 4px;
        background: var(--teal);
        transform: translate(-50%, -50%) rotate(45deg);
        opacity: 0.78;
      }

      .nav-links {
        display: flex;
        align-items: center;
        gap: 18px;
        color: var(--ink-soft);
        font-size: 14px;
        font-weight: 650;
      }

      .nav-links a {
        text-decoration: none;
      }

      .shell {
        width: min(1120px, calc(100% - 40px));
        margin: 0 auto;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.02fr) minmax(320px, 0.78fr);
        gap: 48px;
        align-items: center;
        min-height: calc(100vh - 88px);
        padding: 24px 0 70px;
      }

      .hero > * {
        min-width: 0;
      }

      h1 {
        max-width: 760px;
        margin: 0;
        color: var(--ink);
        font-size: clamp(54px, 8vw, 108px);
        line-height: 0.94;
        font-weight: 780;
        letter-spacing: 0;
      }

      .hero-copy {
        max-width: 680px;
        margin: 28px 0 0;
        color: var(--ink-soft);
        font-size: clamp(18px, 2vw, 23px);
        line-height: 1.55;
        overflow-wrap: break-word;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 34px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 52px;
        padding: 0 22px;
        border: 1px solid var(--ink);
        border-radius: 8px;
        color: #fff;
        background: var(--ink);
        font-size: 15px;
        font-weight: 760;
        text-decoration: none;
        box-shadow: 0 16px 38px rgba(32, 40, 58, 0.18);
      }

      .button.secondary {
        color: var(--ink);
        background: rgba(255, 255, 255, 0.72);
        border-color: var(--line);
        box-shadow: none;
      }

      .proof {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        max-width: 720px;
        margin-top: 44px;
      }

      .proof div {
        border-top: 1px solid var(--line);
        padding-top: 14px;
        color: var(--ink-soft);
        font-size: 14px;
        line-height: 1.45;
      }

      .proof strong {
        display: block;
        margin-bottom: 5px;
        color: var(--ink);
        font-size: 15px;
      }

      .phone-stage {
        position: relative;
        min-height: 620px;
      }

      .phone {
        position: absolute;
        right: 0;
        top: 18px;
        width: min(360px, 100%);
        min-height: 610px;
        border: 10px solid #1f2737;
        border-radius: 38px;
        background: #f7f6f2;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .phone::before {
        position: absolute;
        top: 12px;
        left: 50%;
        width: 92px;
        height: 6px;
        border-radius: 999px;
        background: #d8d4cd;
        content: "";
        transform: translateX(-50%);
      }

      .screen {
        padding: 58px 22px 24px;
      }

      .scan-card,
      .feed-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 16px 40px rgba(32, 40, 58, 0.08);
      }

      .scan-card {
        padding: 20px;
      }

      .status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }

      .status span {
        color: var(--ink-soft);
        font-size: 12px;
        font-weight: 720;
        text-transform: uppercase;
      }

      .risk {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--teal), var(--lavender));
        box-shadow: 0 0 0 8px rgba(102, 183, 184, 0.13);
      }

      .scan-title {
        margin: 0 0 8px;
        font-size: 27px;
        line-height: 1.08;
        font-weight: 780;
      }

      .scan-text {
        margin: 0;
        color: var(--ink-soft);
        font-size: 14px;
        line-height: 1.48;
      }

      .feed-card {
        margin-top: 16px;
        padding: 16px;
      }

      .line {
        height: 10px;
        margin: 12px 0;
        border-radius: 999px;
        background: #e4e0d8;
      }

      .line.short {
        width: 62%;
      }

      .bubble {
        position: absolute;
        right: 24px;
        bottom: 62px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 14px;
        border-radius: 999px;
        color: #fff;
        background: var(--ink);
        box-shadow: 0 18px 42px rgba(32, 40, 58, 0.28);
        font-size: 13px;
        font-weight: 740;
      }

      .pulse {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--teal);
      }

      .sections {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 26px;
        padding: 70px 0 96px;
        border-top: 1px solid var(--line);
      }

      .section h2 {
        margin: 0 0 12px;
        color: var(--ink);
        font-size: 23px;
        line-height: 1.2;
      }

      .section p {
        margin: 0;
        color: var(--ink-soft);
        font-size: 15px;
        line-height: 1.62;
      }

      .demo-band {
        padding: 86px 0 98px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(246, 245, 252, 0.72)),
          rgba(255, 255, 255, 0.48);
        border-top: 1px solid var(--line);
      }

      .demo-head {
        display: grid;
        grid-template-columns: minmax(0, 0.72fr) minmax(280px, 0.28fr);
        gap: 32px;
        align-items: end;
        margin-bottom: 34px;
      }

      .demo-head h2 {
        margin: 0;
        color: var(--ink);
        font-size: clamp(34px, 5vw, 58px);
        line-height: 1;
      }

      .demo-head p {
        margin: 0;
        color: var(--ink-soft);
        font-size: 17px;
        line-height: 1.58;
      }

      .interactive-demo {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(320px, 0.58fr);
        gap: 30px;
        align-items: stretch;
      }

      .demo-stage {
        position: relative;
        min-height: 560px;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 8px;
        background:
          radial-gradient(circle at 25% 16%, rgba(102, 183, 184, 0.2), transparent 24%),
          radial-gradient(circle at 82% 22%, rgba(170, 162, 230, 0.24), transparent 28%),
          #f8f7f3;
        box-shadow: 0 28px 80px rgba(32, 40, 58, 0.12);
      }

      .premium-phone {
        position: absolute;
        top: 50%;
        left: 50%;
        width: min(310px, calc(100% - 56px));
        min-height: 500px;
        border: 10px solid var(--ink);
        border-radius: 38px;
        background: #f7f6f2;
        box-shadow: 0 34px 90px rgba(32, 40, 58, 0.2);
        transform: translate(-50%, -50%);
        overflow: hidden;
      }

      .premium-phone::before {
        position: absolute;
        top: 16px;
        left: 50%;
        width: 88px;
        height: 6px;
        border-radius: 999px;
        background: #d8d4cd;
        content: "";
        transform: translateX(-50%);
      }

      .phone-screen {
        padding: 56px 20px 20px;
      }

      .demo-feed {
        display: grid;
        gap: 14px;
        transition: transform 420ms ease;
      }

      .demo-post {
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.9);
      }

      .demo-post.active {
        border-color: rgba(216, 162, 62, 0.55);
        background: #fffaf0;
      }

      .post-top {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }

      .avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--teal), var(--lavender));
      }

      .post-lines {
        display: grid;
        gap: 8px;
      }

      .post-lines span {
        display: block;
        height: 9px;
        border-radius: 999px;
        background: #e4e0d8;
      }

      .post-lines span:nth-child(2) {
        width: 72%;
      }

      .trust-bubble {
        position: absolute;
        right: 22px;
        bottom: 32px;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 166px;
        padding: 12px 15px;
        border-radius: 999px;
        color: #fff;
        background: var(--ink);
        box-shadow: 0 18px 42px rgba(32, 40, 58, 0.28);
        font-size: 13px;
        font-weight: 760;
        transform: translateY(0);
        transition: transform 320ms ease, background 320ms ease;
      }

      .trust-bubble i {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--teal);
        box-shadow: 0 0 0 8px rgba(102, 183, 184, 0.18);
      }

      .detail-sheet {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 22px;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 20px 54px rgba(32, 40, 58, 0.16);
        transform: translateY(130%);
        transition: transform 420ms ease;
      }

      .detail-sheet h3 {
        margin: 0 0 12px;
        color: var(--ink);
        font-size: 22px;
        line-height: 1.2;
      }

      .detail-sheet ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .detail-sheet li {
        display: grid;
        grid-template-columns: 10px 1fr;
        gap: 10px;
        align-items: start;
        margin-top: 10px;
        color: var(--ink-soft);
        font-size: 14px;
        line-height: 1.38;
      }

      .detail-sheet li::before {
        width: 10px;
        height: 10px;
        margin-top: 4px;
        border-radius: 50%;
        background: var(--teal);
        content: "";
      }

      .demo-stage[data-state="scroll"] .demo-feed {
        transform: translateY(-54px);
      }

      .demo-stage[data-state="scan"] .trust-bubble i,
      .demo-stage[data-state="explain"] .trust-bubble i,
      .demo-stage[data-state="source"] .trust-bubble i {
        background: var(--gold);
        box-shadow: 0 0 0 8px rgba(216, 162, 62, 0.18);
      }

      .demo-stage[data-state="explain"] .detail-sheet,
      .demo-stage[data-state="source"] .detail-sheet {
        transform: translateY(0);
      }

      .demo-stage[data-state="source"] .trust-bubble {
        background: var(--teal-dark);
      }

      .control-panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.82);
        box-shadow: 0 18px 52px rgba(32, 40, 58, 0.08);
        padding: 24px;
      }

      .control-panel h3 {
        margin: 0 0 10px;
        color: var(--ink);
        font-size: 28px;
        line-height: 1.12;
      }

      .control-panel p {
        margin: 0;
        color: var(--ink-soft);
        font-size: 15px;
        line-height: 1.58;
      }

      .state-buttons {
        display: grid;
        gap: 10px;
        margin: 22px 0;
      }

      .state-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        min-height: 48px;
        padding: 0 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink);
        background: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 760;
        cursor: pointer;
      }

      .state-button.is-active {
        color: #fff;
        background: var(--ink);
        border-color: var(--ink);
      }

      .feature-list {
        display: grid;
        gap: 14px;
        margin-top: 22px;
      }

      .feature-item {
        padding-top: 14px;
        border-top: 1px solid var(--line);
      }

      .feature-item strong {
        display: block;
        margin-bottom: 4px;
        color: var(--ink);
        font-size: 15px;
      }

      .feature-item span {
        color: var(--ink-soft);
        font-size: 14px;
        line-height: 1.5;
      }

      @media (max-width: 860px) {
        .nav {
          width: calc(100% - 28px);
          max-width: 1120px;
        }

        .nav-links {
          gap: 12px;
          font-size: 13px;
        }

        .shell {
          width: calc(100% - 28px);
          max-width: 1120px;
        }

        .hero {
          grid-template-columns: 1fr;
          gap: 26px;
          min-height: auto;
          padding-top: 30px;
        }

        .phone-stage {
          min-height: 570px;
        }

        .phone {
          left: 50%;
          right: auto;
          transform: translateX(-50%);
        }

        .proof,
        .sections {
          grid-template-columns: 1fr;
        }

        .demo-head,
        .interactive-demo {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .nav-links a:not(:last-child) {
          display: none;
        }

        .hero > div:first-child,
        .proof,
        .sections {
          max-width: 340px;
        }

        h1 {
          max-width: 340px;
          font-size: 42px;
        }

        .hero-copy {
          max-width: 340px;
        }

        .actions {
          max-width: 340px;
        }

        .button {
          width: 100%;
          max-width: 100%;
        }

        .phone {
          width: min(318px, calc(100vw - 42px));
          min-height: 560px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <nav class="nav" aria-label="Primary navigation">
        <a class="brand" href="${publicHomeUrl}">
          <span class="mark" aria-hidden="true"><span class="spark"></span></span>
          TrustLens
        </a>
        <div class="nav-links">
          <a href="${githubRepoUrl}">GitHub</a>
          <a href="${apkDownloadUrl}">APK</a>
        </div>
      </nav>

      <section class="shell hero">
        <div>
          <h1>Safer scrolling, one pause at a time.</h1>
          <p class="hero-copy">
            TrustLens watches the visible post, link, and screenshot context you choose to assess, then turns it into
            a clear risk label before a scam, hoax, or panic-share gets a chance to travel.
          </p>
          <div class="actions">
            <a class="button" href="${apkDownloadUrl}">Download Android APK</a>
            <a class="button secondary" href="${githubRepoUrl}">View GitHub repo</a>
          </div>
          <div class="proof" aria-label="TrustLens highlights">
            <div><strong>Android-first</strong>Accessibility-service prototype for capturing visible feed context.</div>
            <div><strong>Docker-ready</strong>Self-host the TypeScript API with one Compose command.</div>
            <div><strong>Cautious by design</strong>Shows credibility signals, not overconfident verdicts.</div>
          </div>
        </div>

        <div class="phone-stage" aria-hidden="true">
          <div class="phone">
            <div class="screen">
              <div class="scan-card">
                <div class="status">
                  <span>TrustLens scan</span>
                  <div class="risk"></div>
                </div>
                <h2 class="scan-title">Needs checking</h2>
                <p class="scan-text">Urgent wording and a shortened link were found. Open the source before sharing.</p>
              </div>
              <div class="feed-card">
                <div class="line"></div>
                <div class="line short"></div>
                <div class="line"></div>
                <div class="line short"></div>
              </div>
              <div class="feed-card">
                <div class="line short"></div>
                <div class="line"></div>
                <div class="line"></div>
              </div>
            </div>
            <div class="bubble"><span class="pulse"></span> Tap for why</div>
          </div>
        </div>
      </section>

      <section class="shell sections">
        <div class="section">
          <h2>Captures what is visible</h2>
          <p>Text, links, OCR hints, page titles, and account signals can be sent to the same stable assessment contract.</p>
        </div>
        <div class="section">
          <h2>Explains the risk plainly</h2>
          <p>Results come back as Low, Medium, High, or Cannot verify with short reasons and elderly-friendly next steps.</p>
        </div>
        <div class="section">
          <h2>Runs where teams demo</h2>
          <p>The API ships as a Cloudflare Worker or as a Docker container with optional OCR and evidence storage.</p>
        </div>
      </section>

      <section class="demo-band" id="demo">
        <div class="shell">
          <div class="demo-head">
            <h2>The app flow in motion.</h2>
            <p>Use the controls to move through the TrustLens interaction: passive while scrolling, active after a pause, and plain-spoken when the user asks why.</p>
          </div>
          <div class="interactive-demo">
            <div class="demo-stage" data-state="scan" id="demo-stage" aria-label="Interactive TrustLens app mockup">
              <div class="premium-phone">
                <div class="phone-screen">
                  <div class="demo-feed">
                    <div class="demo-post">
                      <div class="post-top"><span class="avatar"></span><div class="post-lines"><span></span><span></span></div></div>
                      <div class="post-lines"><span></span><span></span><span></span></div>
                    </div>
                    <div class="demo-post active">
                      <div class="post-top"><span class="avatar"></span><div class="post-lines"><span></span><span></span></div></div>
                      <div class="post-lines"><span></span><span></span><span></span></div>
                    </div>
                    <div class="demo-post">
                      <div class="post-top"><span class="avatar"></span><div class="post-lines"><span></span><span></span></div></div>
                      <div class="post-lines"><span></span><span></span></div>
                    </div>
                  </div>
                </div>
                <div class="trust-bubble" id="demo-bubble"><i></i><span>Needs checking</span></div>
                <div class="detail-sheet" id="demo-sheet">
                  <h3 id="demo-sheet-title">Needs checking</h3>
                  <ul id="demo-sheet-list">
                    <li>Shortened link hides the destination.</li>
                    <li>Urgent wording asks the user to act fast.</li>
                    <li>No official source is visible yet.</li>
                  </ul>
                </div>
              </div>
            </div>
            <aside class="control-panel">
              <h3>Designed for a calm second opinion.</h3>
              <p id="demo-description">After the user pauses, TrustLens checks the visible context and returns a risk label without turning the feed into a dashboard.</p>
              <div class="state-buttons" aria-label="Demo states">
                <button class="state-button" data-demo-state="scroll" type="button">Scroll passively <span>01</span></button>
                <button class="state-button is-active" data-demo-state="scan" type="button">Pause scan <span>02</span></button>
                <button class="state-button" data-demo-state="explain" type="button">Explain why <span>03</span></button>
                <button class="state-button" data-demo-state="source" type="button">Check source <span>04</span></button>
              </div>
              <div class="feature-list">
                <div class="feature-item"><strong>Visible evidence only</strong><span>Text, links, OCR hints, page titles, and account signals stay tied to what the user can see.</span></div>
                <div class="feature-item"><strong>Plain labels</strong><span>Low, medium, high, or cannot verify, with reasons that are easy to act on.</span></div>
                <div class="feature-item"><strong>Docker-backed API</strong><span>The same TypeScript service powers the homepage and the assessment endpoint without route collisions.</span></div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
    <script>
      const demoCopy = {
        scroll: {
          bubble: "Waiting",
          title: "Still scrolling",
          description: "TrustLens stays quiet while the user is actively moving through a feed, so it does not interrupt normal browsing.",
          items: ["No capture while scrolling.", "The bubble remains passive.", "A pause starts the scan."]
        },
        scan: {
          bubble: "Needs checking",
          title: "Needs checking",
          description: "After the user pauses, TrustLens checks the visible context and returns a risk label without turning the feed into a dashboard.",
          items: ["Shortened link hides the destination.", "Urgent wording asks the user to act fast.", "No official source is visible yet."]
        },
        explain: {
          bubble: "Tap for why",
          title: "Why this needs care",
          description: "The detail view explains the strongest signals in normal language, then gives a clear next step before the user shares.",
          items: ["Link destination is unclear.", "The claim relies on pressure language.", "Open the original source first."]
        },
        source: {
          bubble: "Source check",
          title: "Source check queued",
          description: "For deeper review, the app can ask the backend to compare visible claims against supplied links and optional web verification.",
          items: ["Compare source domain with link text.", "Check if evidence supports the claim.", "Return uncertainty instead of guessing."]
        }
      };

      const demoStage = document.getElementById("demo-stage");
      const demoBubble = document.querySelector("#demo-bubble span");
      const demoDescription = document.getElementById("demo-description");
      const demoSheetTitle = document.getElementById("demo-sheet-title");
      const demoSheetList = document.getElementById("demo-sheet-list");
      const demoButtons = Array.from(document.querySelectorAll("[data-demo-state]"));

      function setDemoState(state) {
        const copy = demoCopy[state] || demoCopy.scan;
        demoStage.dataset.state = state;
        demoBubble.textContent = copy.bubble;
        demoDescription.textContent = copy.description;
        demoSheetTitle.textContent = copy.title;
        demoSheetList.innerHTML = "";
        copy.items.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          demoSheetList.appendChild(li);
        });
        demoButtons.forEach((button) => {
          button.classList.toggle("is-active", button.dataset.demoState === state);
        });
      }

      demoButtons.forEach((button) => {
        button.addEventListener("click", () => setDemoState(button.dataset.demoState));
      });
    </script>
  </body>
</html>`;
}
