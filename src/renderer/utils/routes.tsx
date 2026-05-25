import React, { lazy } from 'react';
import Layout from '../components/Layout';
import { Navigate } from 'react-router';
import { Box, CircularProgress } from '@mui/material';

const AllSongs = lazy(() => import('../views/AllSongs'));
const Albums = lazy(() => import('../views/Albums'));
const AlbumDetail = lazy(() => import('../views/AlbumDetail'));
const AllArtists = lazy(() => import('../views/artists/AllArtists'));
const ArtistDetail = lazy(() => import('../views/artists/ArtistDetail'));
const Search = lazy(() => import('../views/Search'));
const Settings = lazy(() => import('../views/Settings'));
const RecentlyAdded = lazy(() => import('../views/RecentlyAdded'));
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

const routes = [
  {
    path: '/main_window',
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <AllSongs />
          </React.Suspense>
        ),
      },
      {
        path: 'favourites',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Search />
          </React.Suspense>
        ),
      },
      {
        path: 'playlists',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Search />
          </React.Suspense>
        ),
      },
      {
        path: 'albums',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Albums />
          </React.Suspense>
        ),
      },
      {
        path: 'albums/:albumId',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <AlbumDetail />
          </React.Suspense>
        ),
      },
      {
        path: 'artists',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <AllArtists />
          </React.Suspense>
        ),
      },
      {
        path: 'artists/:artistId',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <ArtistDetail />
          </React.Suspense>
        ),
      },
      {
        path: 'album-artists',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <AllArtists showAlbumsOnly />
          </React.Suspense>
        ),
      },
      {
        path: 'album-artists/:artistId',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <ArtistDetail showAlbumArtist />
          </React.Suspense>
        ),
      },
      {
        path: 'folders',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Folders />
          </React.Suspense>
        ),
      },
      {
        path: 'folder-hierarchy',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <FolderHierarchy />
          </React.Suspense>
        ),
      },
      {
        path: 'genres',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Genres />
          </React.Suspense>
        ),
      },
      {
        path: 'genres/:genreId',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <GenreDetail />
          </React.Suspense>
        ),
      },
      {
        path: 'years',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Years />
          </React.Suspense>
        ),
      },
      {
        path: 'years/:year',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <YearDetail />
          </React.Suspense>
        ),
      },
      {
        path: 'recently-added',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <RecentlyAdded />
          </React.Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <React.Suspense fallback={<BigLoader />}>
            <Settings />
          </React.Suspense>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="main_window" /> },
];

export default routes;
