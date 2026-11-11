/**
 * Marca do PreçoClaro: duas folhas verdes. SVG único, usado na navbar, no rodapé e nas
 * miniaturas da Home, para a identidade ser a mesma em todas as páginas.
 * O tamanho vem do CSS (.pc-brandmark) ou da propriedade `size`.
 */
export default function BrandMark({ size, className = '' }: { size?: number; className?: string }) {
  return <svg className={`pc-brandmark ${className}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
    {/* folha maior, ao fundo */}
    <path d="M5.2 27.4C3.6 15.9 9.6 6.6 22.4 3.6c1.9 11.3-3.7 21.3-17.2 23.8Z" fill="var(--pc-leaf-dark, #4f7a28)" />
    <path d="M6.4 26.2C9.3 18.2 13.9 11.8 21 5.6" fill="none" stroke="var(--pc-leaf-vein, #f8f7f3)" strokeWidth="1.15" strokeLinecap="round" opacity=".55" />
    {/* folha menor, à frente */}
    <path d="M13.6 28.7c1.6-7.3 6.9-12.1 15.8-12.9.3 8.1-5.4 13.5-15.8 12.9Z" fill="var(--pc-leaf-light, #a9cf3f)" />
    <path d="M14.8 27.9c3.3-4.7 7.5-8.1 13.3-10.8" fill="none" stroke="var(--pc-leaf-vein, #f8f7f3)" strokeWidth="1" strokeLinecap="round" opacity=".6" />
  </svg>;
}
