begin;

alter type public.source_type add value if not exists 'webm';
alter type public.source_type add value if not exists 'direct';

commit;
