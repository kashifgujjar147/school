import { Award, BookOpen, Bus, CalendarDays, Compass, FlaskConical, Globe, GraduationCap, Heart, Languages, Library, Microscope, Monitor, Music, Palette, ShieldCheck, Star, Trees, Trophy, Users, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  book: BookOpen, flask: FlaskConical, monitor: Monitor, library: Library, trophy: Trophy, trees: Trees, bus: Bus, shield: ShieldCheck, palette: Palette,
  music: Music, globe: Globe, users: Users, graduation: GraduationCap, heart: Heart, star: Star, compass: Compass, microscope: Microscope, languages: Languages, calendar: CalendarDays, award: Award
};
export function SectionIcon({ name, className = 'h-6 w-6' }: { name: string | null | undefined; className?: string }) {
  const I = ICONS[name ?? ''] ?? Star;
  return <I className={className} strokeWidth={1.4} aria-hidden />;
}
