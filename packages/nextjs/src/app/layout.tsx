import type { Metadata } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const poppins = Poppins({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

export const metadata: Metadata = {
	title: "greg",
	description: "OpenAPI semantic search + chat",
};

// Inline script that runs before first paint to prevent theme flash.
const themeScript = `(function(){try{var t=localStorage.getItem("greg-theme")||"system";var el=document.documentElement;if(t==="claude")el.classList.add("claude");else if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme:dark)").matches))el.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={cn(poppins.variable, jetbrainsMono.variable)} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body>{children}</body>
		</html>
	);
}
