import type { Metadata } from "next";
import SburbApp from "./SburbApp";

export const metadata: Metadata = {
  description:
    "A mobile-first character sheet, equipment reference, Classpect library, and personal Strife menu for a custom SBURB tabletop RPG.",
};

export default function Home() {
  return <SburbApp />;
}
