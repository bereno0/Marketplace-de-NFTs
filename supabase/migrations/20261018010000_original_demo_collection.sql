update public.nfts as nft
set
  title = collection.title,
  collection = 'Clube da Copa',
  creator = collection.creator,
  image = collection.image,
  category = 'art',
  description = collection.description,
  traits = collection.traits
from (
  values
    (
      'aurora-001',
      'Milo da Copa',
      'Lia Monte',
      '/artwork/milo-da-copa.svg',
      'Milo observa a floresta do alto das copas, sempre em busca de frutas raras e novas amizades.',
      array['Explorador', 'Folhagem', 'Edição limitada']::text[]
    ),
    (
      'pixel-021',
      'Nina Violeta',
      'Lia Monte',
      '/artwork/nina-violeta.svg',
      'Nina é uma inventora paciente que transforma cipós, sementes e sucata em pequenos instrumentos.',
      array['Inventora', 'Cachecol violeta', 'Artesã']::text[]
    ),
    (
      'vanta-407',
      'Ivy, Guardiã do Bosque',
      'Tomás Vale',
      '/artwork/ivy-guardia-do-bosque.svg',
      'Ivy conhece cada trilha do bosque e protege as nascentes onde os animais se reúnem ao amanhecer.',
      array['Guardiã', 'Olhar atento', 'Bosque antigo']::text[]
    ),
    (
      'glass-115',
      'Bento Dourado',
      'Tomás Vale',
      '/artwork/bento-dourado.svg',
      'Bento é um contador de histórias que coleciona mapas antigos e divide lendas em volta da fogueira.',
      array['Contador de histórias', 'Âmbar', 'Viajante']::text[]
    ),
    (
      'echo-920',
      'Sol, Sinal do Sol',
      'Rafa Luz',
      '/artwork/sol-sinal-do-sol.svg',
      'Sol acorda cedo para levar mensagens entre as comunidades e nunca deixa ninguém sem notícias.',
      array['Mensageiro', 'Fone de folhas', 'Peça única']::text[]
    ),
    (
      'solace-771',
      'Tico, Ritmo da Mata',
      'Rafa Luz',
      '/artwork/tico-ritmo-da-mata.svg',
      'Tico marca o compasso das festas da mata com tambores feitos de madeira caída e sementes.',
      array['Músico', 'Ritmo tropical', 'Colecionável']::text[]
    )
) as collection(id, title, creator, image, description, traits)
where nft.id = collection.id;
