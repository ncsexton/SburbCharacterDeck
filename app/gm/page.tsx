import Link from "next/link";

export const metadata = {
  title: "GM Route Preview",
};

export default function GmPreviewPage() {
  return (
    <main className="gm-preview">
      <section>
        <p className="eyebrow">Reserved route · Stage 4</p>
        <span className="gm-mark">GM</span>
        <h1>Game Master management is intentionally deferred.</h1>
        <p>
          The Player prototype is ready for comfort and usability testing before
          authentication, campaigns, permanent data editing, duplication, and
          cloud ownership rules are introduced.
        </p>
        <div className="gm-scope-grid">
          <article>
            <strong>Available now</strong>
            <span>
              Manual resource correction, exact meter values, Stat Total /
              Modifier overrides, JSON backup, and seed restoration.
            </span>
          </article>
          <article>
            <strong>Planned here</strong>
            <span>
              Campaign roster, character editor, equipment and Affix editors,
              progression awards, duplication, and full history correction.
            </span>
          </article>
        </div>
        <Link className="button button-primary" href="/">
          ← Return to Mina Quill
        </Link>
      </section>
    </main>
  );
}
