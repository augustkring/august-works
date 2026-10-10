import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = {title:{default:"BLENTERA",template:"%s | BLENTERA"},robots:{index:false,follow:false},description:"A shared workspace for company knowledge, work and AI agents."};
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en"><body>{children}<script src="/site.js" defer></script></body></html>}
