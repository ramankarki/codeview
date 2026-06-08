interface HeroProps {
  title: string;
  subtitle: string;
  cta: { label: string; href: string };
}

export function HeroSection({ title, subtitle, cta }: HeroProps) {
  return (
    <section className="text-center py-20">
      <h1 className="text-5xl font-extrabold text-gray-900 mb-4">{title}</h1>
      <p className="text-xl text-gray-600 mb-8">{subtitle}</p>
      <a
        href={cta.href}
        className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        {cta.label}
      </a>
    </section>
  );
}
