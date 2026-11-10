import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';

/**
 * Foto do produto ou um marcador neutro.
 *
 * A URL só chega aqui se o servidor tiver uma foto ligada ao MESMO código de barras
 * (ou o arquivo local de um produto de demonstração). Quando não há foto, ou quando a
 * imagem falha ao carregar, aparece o marcador — nunca a foto de outro produto.
 * O espaço é reservado antes do carregamento (sem salto de layout) e a imagem só é
 * baixada quando se aproxima da tela (loading="lazy").
 */
export default function ProductImage({ src, alt = '', size = 'md', className = '' }: {
  src?: string | null; alt?: string; size?: 'sm' | 'md' | 'lg'; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [src]);
  const valid = typeof src === 'string' && (src.startsWith('https://') || src.startsWith('/')) && !failed;
  // Pede ao CDN uma versão do tamanho exibido, quando a URL permite.
  const width = size === 'lg' ? 600 : 200;
  const optimized = valid && src!.includes('ik.imagekit.io') ? src!.replace(/tr=w-\d+/, `tr=w-${width}`) : src;
  return <span className={`pc-pimg pc-pimg-${size} ${valid && loaded ? 'is-loaded' : ''} ${className}`}>
    {valid
      ? <img src={optimized!} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          width={width} height={width} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      : <span className="pc-pimg-empty" role="img" aria-label={alt ? `${alt} (sem foto disponível)` : 'Sem foto disponível'}>
          <Package size={size === 'lg' ? 54 : size === 'md' ? 28 : 20} strokeWidth={1.3} aria-hidden="true" />
          {size !== 'sm' && <small>Sem foto</small>}
        </span>}
  </span>;
}
