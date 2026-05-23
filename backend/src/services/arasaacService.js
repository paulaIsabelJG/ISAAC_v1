const axios = require('axios');

const api = axios.create({
  baseURL: 'https://api.arasaac.org/api',
  timeout: 10000
});

exports.searchPictograms = async (searchText, language = 'es') => {
  const encodedSearchText = encodeURIComponent(searchText.trim());
  const response = await api.get(`/pictograms/${language}/search/${encodedSearchText}`);
  return response.data || [];
};

exports.getPictogramById = async (id, language = 'es') => {
  const response = await api.get(`/pictograms/${language}/${id}`);
  return response.data;
};
