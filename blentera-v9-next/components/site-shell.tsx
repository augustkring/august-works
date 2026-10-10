import type { ReactNode } from "react";
const links = [
  { label: "Platform", href: "/platform/", id: "platform" },
  { label: "About", href: "/about/", id: "about" },
  { label: "Control", href: "/control/", id: "control" },
] as const;
export function SiteShell({page,children}:{page:string;children:ReactNode}) {
 return <>
 <a className="skip" href="#main">Skip to content</a>
 <header className="header"><div className="wrapper header-content">
   <a className="brand" aria-label="Blentera home" href="/">blentera<b>.</b></a>
   <nav className="nav" aria-label="Primary navigation">
    {links.map(item=><a key={item.id} href={item.href} aria-current={page===item.id?"page":undefined}>{item.label}</a>)}
   </nav>
   <a className="header-action" href="/#how-it-works">See how it works <span aria-hidden="true">↗</span></a>
   <button className="menu-button" type="button" data-menu-toggle aria-label="Toggle navigation" aria-controls="mobile-navigation" aria-expanded="false"/>
  </div>
  <nav className="mobile-menu" id="mobile-navigation" aria-label="Mobile navigation" hidden>
    <a href="/" aria-current={page==='home'?"page":undefined}>Overview</a>
    {links.map(item=><a key={item.id} href={item.href} aria-current={page===item.id?"page":undefined}>{item.label}</a>)}
    <a href="/#how-it-works">How it works</a>
  </nav>
 </header>
 {children}
 <footer><div className="wrapper">
    <div className="footer-grid"><a className="brand" href="/">blentera<b>.</b></a>
     <nav className="footer-links" aria-label="Footer navigation"><a href="/">Overview</a>{links.map(item=><a key={item.id} href={item.href}>{item.label}</a>)}</nav></div>
    <p className="footer-statement">This is an illustrative website and product-concept preview, not a connected customer workspace. Advanced capabilities remain gated, and BLENTERA's hosted production service has not yet qualified for release. Product availability and regulatory obligations require separate verification.</p>
 </div></footer></>;
}
