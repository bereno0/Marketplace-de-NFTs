create table public.nfts (
  id text primary key,
  title text not null,
  collection text not null,
  creator text not null,
  image text not null,
  price_eth numeric(18, 8) not null check (price_eth >= 0),
  price_usd numeric(12, 2) not null check (price_usd >= 0),
  category text not null,
  likes integer not null default 0 check (likes >= 0),
  available integer not null default 0 check (available >= 0),
  created_at timestamptz not null,
  description text not null,
  traits text[] not null default '{}'
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nft_id text not null references public.nfts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, nft_id)
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  network text not null check (network in ('Ethereum Mainnet', 'Base', 'Polygon')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index wallets_one_primary_per_user
  on public.wallets (user_id)
  where is_primary;

create unique index wallets_unique_address_per_network
  on public.wallets (user_id, network, address);

insert into public.nfts (
  id, title, collection, creator, image, price_eth, price_usd,
  category, likes, available, created_at, description, traits
) values
  (
    'aurora-001', 'Aurora Bloom', 'Nebula Drift', 'Izzy M.',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
    0.83, 2530, 'art', 421, 3, '2026-08-12T10:00:00Z',
    'Um estudo etéreo de luz que combina flora digital e faixas de aurora em um céu noturno surreal.',
    array['3D', 'Aurora', 'Raro']
  ),
  (
    'pixel-021', 'Pixel Tide', 'Signal Studios', 'Nia Rig',
    'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80',
    1.26, 3840, 'gaming', 288, 2, '2026-09-03T10:00:00Z',
    'Uma coleção de margens neon que captura fragmentação, ritmo e a coragem de um novo mundo.',
    array['Games', 'Animado', 'Limitado']
  ),
  (
    'vanta-407', 'Vanta Echo', 'Night Phase', 'Rin O.',
    'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80',
    0.52, 1640, 'music', 502, 5, '2026-09-18T10:00:00Z',
    'Uma paisagem sonora cinematográfica, representada por uma onda escultural suspensa em vidro negro.',
    array['Áudio', 'Raro', 'Cinematográfico']
  ),
  (
    'glass-115', 'Glass Horizon', 'Refracted', 'Dorian K.',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
    0.94, 2970, 'photography', 364, 4, '2026-10-02T10:00:00Z',
    'Um horizonte panorâmico em que reflexos de vidro fragmentam a paisagem em movimentos impossíveis.',
    array['Cidade', 'Dourado', 'Edição']
  ),
  (
    'echo-920', 'Echo Protocol', 'Synth Vault', 'Mara Flux',
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
    1.58, 4820, 'utility', 196, 1, '2026-07-24T10:00:00Z',
    'Um token de acesso que representa um arquivo vivo e mutável de sinais de rede e memória digital.',
    array['Utilidade', 'Gênese', '1/1']
  ),
  (
    'solace-771', 'Solace Thread', 'Polar Frame', 'Arlo S.',
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80',
    0.67, 2100, 'fashion', 319, 6, '2026-10-11T10:00:00Z',
    'Uma composição tátil de texturas e suavidade, transformada em um mito vestível para colecionadores.',
    array['Moda', 'Suave', 'Colecionável']
  )
on conflict (id) do nothing;

alter table public.nfts enable row level security;
alter table public.profiles enable row level security;
alter table public.favorites enable row level security;
alter table public.wallets enable row level security;

create policy "NFTs are readable by everyone"
  on public.nfts for select
  to anon, authenticated
  using (true);

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their own favorites"
  on public.favorites for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can read their own wallets"
  on public.wallets for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.nfts to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select on public.wallets to authenticated;

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_display_name text;
begin
  profile_display_name := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Colecionador'
    ),
    40
  );
  if char_length(profile_display_name) < 2 then
    profile_display_name := 'Colecionador';
  end if;

  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    profile_display_name
  );
  return new;
end;
$$;

create function public.update_profile_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_profile_timestamp();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create function public.get_catalog_page(
  p_query text default '',
  p_category text default 'all',
  p_sort text default 'popular',
  p_page integer default 1,
  p_page_size integer default 4
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select n.*
    from public.nfts n
    where (p_category = 'all' or n.category = p_category)
      and (
        coalesce(trim(p_query), '') = ''
        or n.title ilike '%' || trim(p_query) || '%'
        or n.collection ilike '%' || trim(p_query) || '%'
        or n.creator ilike '%' || trim(p_query) || '%'
        or n.description ilike '%' || trim(p_query) || '%'
      )
  ),
  counted as (
    select count(*)::integer as total from filtered
  ),
  ranked as (
    select
      f.*,
      row_number() over (
        order by
          case when coalesce(p_sort, 'popular') = 'price-low' then f.price_eth end asc nulls last,
          case when coalesce(p_sort, 'popular') = 'price-high' then f.price_eth end desc nulls last,
          case when coalesce(p_sort, 'popular') = 'newest' then f.created_at end desc nulls last,
          case when coalesce(p_sort, 'popular') not in ('price-low', 'price-high', 'newest') then f.likes end desc,
          f.id asc
      ) as row_number
    from filtered f
  ),
  paged as (
    select * from ranked
    order by row_number
    limit least(greatest(coalesce(p_page_size, 4), 1), 50)
    offset (greatest(coalesce(p_page, 1), 1)::bigint - 1) * least(greatest(coalesce(p_page_size, 4), 1), 50)
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            'collection', p.collection,
            'creator', p.creator,
            'image', p.image,
            'priceEth', to_char(p.price_eth, 'FM999999999990.00'),
            'priceUsd', p.price_usd,
            'category', p.category,
            'likes', p.likes,
            'available', p.available,
            'createdAt', p.created_at,
            'description', p.description,
            'traits', p.traits
          )
          order by p.row_number
        )
        from paged p
      ),
      '[]'::jsonb
    ),
    'total', (select total from counted),
    'page', greatest(coalesce(p_page, 1), 1),
    'pageSize', least(greatest(coalesce(p_page_size, 4), 1), 50)
  );
$$;

create function public.calculate_order_quote(
  p_cart jsonb,
  p_coupon_code text default ''
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  line record;
  nft public.nfts%rowtype;
  subtotal numeric(18, 8) := 0;
  discount numeric(18, 8) := 0;
  network_fee numeric(18, 8) := 0.14;
  items jsonb := '[]'::jsonb;
  coupon text := upper(trim(coalesce(p_coupon_code, '')));
begin
  if p_cart is null or jsonb_typeof(p_cart) is distinct from 'array' then
    raise exception using message = 'Os dados do pedido estão incompletos.', errcode = '22023';
  end if;

  if jsonb_array_length(p_cart) = 0 then
    raise exception using message = 'Os dados do pedido estão incompletos.', errcode = '22023';
  end if;

  if coupon <> '' and coupon <> 'PIXEL10' then
    raise exception using message = 'O cupom é inválido ou expirou.', errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_cart) as cart(value)
    where jsonb_typeof(cart.value) <> 'object'
      or jsonb_typeof(cart.value -> 'nftId') <> 'string'
      or jsonb_typeof(cart.value -> 'quantity') <> 'number'
      or coalesce(cart.value ->> 'quantity', '') !~ '^[1-9][0-9]*$'
  ) then
    raise exception using message = 'A quantidade solicitada é inválida.', errcode = '22023';
  end if;

  for line in
    select cart.value ->> 'nftId' as nft_id,
      sum((cart.value ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(p_cart) as cart(value)
    group by cart.value ->> 'nftId'
  loop
    select * into nft from public.nfts where id = line.nft_id;
    if not found or line.quantity > nft.available then
      raise exception using
        message = 'Um NFT não está disponível ou a quantidade solicitada excede o estoque.',
        errcode = 'P0002';
    end if;

    subtotal := subtotal + nft.price_eth * line.quantity;
    items := items || jsonb_build_array(jsonb_build_object(
      'nftId', nft.id,
      'title', nft.title,
      'collection', nft.collection,
      'image', nft.image,
      'quantity', line.quantity,
      'priceEth', to_char(nft.price_eth, 'FM999999999990.00')
    ));
  end loop;

  if coupon = 'PIXEL10' then
    discount := round(subtotal * 0.1, 2);
  end if;

  return jsonb_build_object(
    'items', items,
    'subtotalEth', to_char(round(subtotal, 2), 'FM999999999990.00'),
    'discountEth', to_char(discount, 'FM999999999990.00'),
    'networkFeeEth', to_char(network_fee, 'FM999999999990.00'),
    'totalEth', to_char(round(subtotal, 2) - discount + network_fee, 'FM999999999990.00')
  );
end;
$$;

create function public.set_primary_wallet(
  p_address text,
  p_network text default 'Ethereum Mainnet'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  wallet public.wallets%rowtype;
begin
  if current_user_id is null then
    raise exception using message = 'Entre na sua conta para continuar.', errcode = '28000';
  end if;

  perform 1 from auth.users where id = current_user_id for update;

  if p_address is null or p_address !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception using message = 'Informe um endereço de carteira válido.', errcode = '22023';
  end if;

  if p_network is null or p_network not in ('Ethereum Mainnet', 'Base', 'Polygon') then
    raise exception using message = 'A rede selecionada não é compatível.', errcode = '22023';
  end if;

  update public.wallets
    set is_primary = false
    where user_id = current_user_id and is_primary;

  insert into public.wallets (user_id, address, network, is_primary)
    values (current_user_id, p_address, p_network, true)
    on conflict (user_id, network, address)
    do update set is_primary = true
    returning * into wallet;

  return jsonb_build_object(
    'id', wallet.id,
    'address', wallet.address,
    'network', wallet.network,
    'primary', wallet.is_primary
  );
end;
$$;

grant execute on function public.get_catalog_page(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.calculate_order_quote(jsonb, text) to anon, authenticated;
revoke all on function public.set_primary_wallet(text, text) from public, anon;
grant execute on function public.set_primary_wallet(text, text) to authenticated;
