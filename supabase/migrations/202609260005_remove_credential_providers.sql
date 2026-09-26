-- Disable providers that require credentials/integration URLs not available to Movyz.
-- Playback fallback remains: FaselHD -> EzVid -> StreamProvider.
update public.providers
set enabled = false,
    status = 'offline',
    updated_at = now()
where key in ('nhdapi', 'egybest');

notify pgrst, 'reload schema';
