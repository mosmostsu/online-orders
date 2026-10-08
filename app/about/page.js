import { BUSINESS, SITE, CONTACT_EMAIL, UPDATED } from '../legal';

export const metadata = { title: 'About — order-sync' };

export default function About() {
  return (
    <div className="legal">
      <h1>About order-sync</h1>
      <div className="sub">Last updated: {UPDATED}</div>

      <p>
        order-sync ({SITE}) is a web dashboard built and used by the team of {BUSINESS}, an online sports-equipment shop in Thailand.
        It brings the shop&rsquo;s online orders, product listings and sales figures from several marketplaces into one place,
        and includes a Video page for reviewing the TikTok videos the shop has posted.
      </p>

      <h2>Video page and TikTok</h2>
      <p>
        The shop owner can connect the shop&rsquo;s own TikTok accounts with TikTok Login Kit. After the owner approves the permission on TikTok&rsquo;s authorization screen,
        the app uses the Display API (<b>video.list</b> scope) to read that account&rsquo;s public videos: posting date, description, link, and view, like, comment and share counts.
        The Video page shows them in a table and a calendar so the team can see on which days videos were posted and how they performed.
      </p>
      <ul>
        <li>The app only reads data of accounts whose owner has authorized it.</li>
        <li>It does not post, edit or delete videos, and does not read other users&rsquo; data.</li>
        <li>Data is not sold or shared with third parties. The owner can disconnect an account at any time.</li>
      </ul>

      <h2>Policies and contact</h2>
      <p>
        See our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
        {CONTACT_EMAIL ? <> Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></> : null}
      </p>
    </div>
  );
}
