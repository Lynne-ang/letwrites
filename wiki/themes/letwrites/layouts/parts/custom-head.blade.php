{{-- Letwrites theme override of BookStack's layouts/parts/custom-head.blade.php.
     The core version wraps the custom head content in @if(!request()->routeIs('settings.category')),
     which prevents the Notion reskin (delivered via app-custom-head) from reaching /settings/* pages,
     leaving the admin area on stock BookStack styling. We remove that guard so the reskin applies
     site-wide, including settings. VERIFY-ON-UPGRADE: re-check the core partial if BookStack changes it. --}}
@inject('headContent', 'BookStack\Theming\CustomHtmlHeadContentProvider')
<!-- Start: custom user content (Letwrites — applied site-wide incl. settings) -->
{!! $headContent->forWeb() !!}
<!-- End: custom user content -->
