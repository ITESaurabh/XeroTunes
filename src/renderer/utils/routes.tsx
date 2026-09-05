import React, { lazy } from 'react';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';
import { Navigate, useLocation } from 'react-router';
import { Box, CircularProgress } from '@mui/material';

const AllSongs = lazy(() => import('../views/AllSongs'));
const Albums = lazy(() => import('../views/Albums'));
const AlbumDetail = lazy(() => import('../views/AlbumDetail'));
const AllArtists = lazy(() => import('../views/artists/AllArtists'));
const ArtistDetail = lazy(() => import('../views/artists/ArtistDetail'));
const Settings = lazy(() => import('../views/Settings'));
const RecentlyAdded = lazy(() => import('../views/RecentlyAdded'));
const Favourites = lazy(() => import('../views/Favourites'));
const Playlists = lazy(() => import('../views/Playlists'));
const PlaylistDetail = lazy(() => import('../views/PlaylistDetail'));
const Streams = lazy(() => import('../views/Streams'));
const StreamDetail = lazy(() => import('../views/StreamDetail'));
const Folders = lazy(() => import('../views/Folders'));
const FolderHierarchy = lazy(() => import('../views/FolderHierarchy'));
const Genres = lazy(() => import('../views/Genres'));
const GenreDetail = lazy(() => import('../views/GenreDetail'));
const Years = lazy(() => import('../views/Years'));
const YearDetail = lazy(() => import('../views/YearDetail'));

const BigLoader = () => {
  return (
    <Box
      sx={{
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
      }}
    >
      <CircularProgress />
    </Box>
  );
};

// Keyed on pathname so a crashed page does not outlive the route it belongs to.
const Page = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} scope="page">
      <React.Suspense fallback={<BigLoader />}>{children}</React.Suspense>
    </ErrorBoundary>
  );
};

const routes = [
  {
    path: '/main_window',
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <Page>
            <AllSongs />
          </Page>
        ),
      },
      {
        path: 'favourites',
        element: (
          <Page>
            <Favourites />
          </Page>
        ),
      },
      {
        path: 'playlists',
        element: (
          <Page>
            <Playlists />
          </Page>
        ),
      },
      {
        path: 'playlists/:playlistId',
        element: (
          <Page>
            <PlaylistDetail />
          </Page>
        ),
      },
      {
        path: 'streams',
        element: (
          <Page>
            <Streams />
          </Page>
        ),
      },
      {
        path: 'streams/:streamId',
        element: (
          <Page>
            <StreamDetail />
          </Page>
        ),
      },
      {
        path: 'albums',
        element: (
          <Page>
            <Albums />
          </Page>
        ),
      },
      {
        path: 'albums/:albumId',
        element: (
          <Page>
            <AlbumDetail />
          </Page>
        ),
      },
      {
        path: 'artists',
        element: (
          <Page>
            <AllArtists />
          </Page>
        ),
      },
      {
        path: 'artists/:artistId',
        element: (
          <Page>
            <ArtistDetail />
          </Page>
        ),
      },
      {
        path: 'album-artists',
        element: (
          <Page>
            <AllArtists showAlbumsOnly />
          </Page>
        ),
      },
      {
        path: 'album-artists/:artistId',
        element: (
          <Page>
            <ArtistDetail showAlbumArtist />
          </Page>
        ),
      },
      {
        path: 'folders',
        element: (
          <Page>
            <Folders />
          </Page>
        ),
      },
      {
        path: 'folder-hierarchy',
        element: (
          <Page>
            <FolderHierarchy />
          </Page>
        ),
      },
      {
        path: 'genres',
        element: (
          <Page>
            <Genres />
          </Page>
        ),
      },
      {
        path: 'genres/:genreId',
        element: (
          <Page>
            <GenreDetail />
          </Page>
        ),
      },
      {
        path: 'years',
        element: (
          <Page>
            <Years />
          </Page>
        ),
      },
      {
        path: 'years/:year',
        element: (
          <Page>
            <YearDetail />
          </Page>
        ),
      },
      {
        path: 'recently-added',
        element: (
          <Page>
            <RecentlyAdded />
          </Page>
        ),
      },
      {
        path: 'settings',
        element: (
          <Page>
            <Settings />
          </Page>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="main_window" /> },
];

export default routes;
