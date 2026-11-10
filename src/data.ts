export type Category = 'Mercados' | 'Farmácias' | 'Eletrônicos' | 'Postos';
export type Product = {
  id: number;
  name: string;
  brand: string;
  size: string;
  category: Category;
  price: number;
  stores: number;
  image: string;
};

// IMPORTANTE: preços e quantidades aqui são FICTÍCIOS, somente para construir a UI.
// Quando houver integração real, serão substituídos por dados da API com fonte/data/loja.
export const products: Product[] = [
  { id: 1, name: 'Arroz Branco', brand: 'Tio João', size: '5 kg', category: 'Mercados', price: 22.90, stores: 3, image: '/products/arroz.png' },
  { id: 2, name: 'Café Tradicional', brand: 'Pilão', size: '500 g', category: 'Mercados', price: 16.49, stores: 4, image: '/products/cafe.png' },
  { id: 3, name: 'Leite Integral', brand: 'Italac', size: '1 L', category: 'Mercados', price: 4.79, stores: 5, image: '/products/leite.png' },
  { id: 4, name: 'Óleo de Soja', brand: 'Liza', size: '900 ml', category: 'Mercados', price: 6.99, stores: 6, image: '/products/oleo.png' },
  { id: 5, name: 'Açúcar Refinado', brand: 'União', size: '1 kg', category: 'Mercados', price: 3.89, stores: 4, image: '/products/acucar.png' },
  { id: 6, name: 'Feijão Carioca', brand: 'Camil', size: '1 kg', category: 'Mercados', price: 7.49, stores: 4, image: '/products/feijao.png' },
  { id: 7, name: 'Macarrão Parafuso', brand: 'Renata', size: '500 g', category: 'Mercados', price: 3.99, stores: 5, image: '/products/macarrao.png' },
  { id: 8, name: 'Farinha de Trigo', brand: 'Dona Benta', size: '1 kg', category: 'Mercados', price: 4.59, stores: 4, image: '/products/farinha.png' },
];

export const brl = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
